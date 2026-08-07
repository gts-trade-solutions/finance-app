// Manual journals + opening balances — the accountant's raw primitive.

import { getState, setState } from '../store';
import { buildEntry, buildReversal, type DraftLine } from '../ledger/posting';
import { logAudit } from './audit';

function nextEntryNo(): number {
  const n = getState().nextEntryNo;
  setState({ nextEntryNo: n + 1 });
  return n;
}

function currentUserId(): string {
  return getState().session?.userId ?? 'system';
}

/** Post a manual journal. Throws UnbalancedEntryError if lines don't balance. */
export function createManualJournal(input: {
  date: string;
  memo: string;
  lines: DraftLine[];
  sourceType?: 'manual' | 'opening';
}): string {
  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date: input.date,
    sourceType: input.sourceType ?? 'manual',
    sourceId: null,
    memo: input.memo,
    lines: input.lines,
    createdBy: currentUserId(),
  });
  setState({ entries: [...getState().entries, entry] });
  logAudit('create', 'journal', entry.id, `JE#${entry.entryNo}`, input.memo);
  return entry.id;
}

/** Reverse any entry (the only way to "undo" — original stays forever). */
export function reverseEntry(entryId: string, date: string, reason: string): string | null {
  const s = getState();
  const original = s.entries.find((e) => e.id === entryId);
  if (!original) return null;
  const reversal = buildReversal(original, {
    entryNo: nextEntryNo(),
    date,
    memo: `Reversal of JE#${original.entryNo}: ${reason}`,
    createdBy: currentUserId(),
  });
  setState({ entries: [...getState().entries, reversal] });
  logAudit('create', 'journal', reversal.id, `JE#${reversal.entryNo}`, `Reversal of JE#${original.entryNo} — ${reason}`);
  return reversal.id;
}
