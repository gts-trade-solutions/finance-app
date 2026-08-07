// ─────────────────────────────────────────────────────────────────────────────
// The mini posting engine — heart of the demo AND of the future product.
//
// Invariants (identical to the planned production PostingService):
//   1. Every entry balances: Σ debits === Σ credits, or the entry is REJECTED.
//   2. Entries are append-only. There is no update/delete — corrections are
//      posted as linked reversal entries (see buildReversal).
//   3. Each line is one-sided: debit XOR credit.
//
// The store calls these builders; nothing else may fabricate JournalEntry
// objects. Account IDs come from the seeded chart of accounts (lib/mock/seed).
// ─────────────────────────────────────────────────────────────────────────────

import type { JournalEntry, JournalLine, Paise, SourceType } from '../types';
import { sumPaise } from '../money';

export class UnbalancedEntryError extends Error {
  constructor(debits: Paise, credits: Paise) {
    super(
      `Journal entry does not balance: debits ${debits} ≠ credits ${credits} (paise). ` +
        'This is a bug in the calling service — entries are never force-posted.',
    );
    this.name = 'UnbalancedEntryError';
  }
}

let idCounter = 0;
/** Demo-grade unique id (no Date.now dependence for SSR stability). */
export function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface DraftLine {
  accountId: string;
  debit?: Paise;
  credit?: Paise;
  contactId?: string;
  branchId?: string;
  description?: string;
}

/**
 * Validate + assemble a journal entry. Throws UnbalancedEntryError if the
 * lines don't sum to zero. Zero-amount lines are dropped.
 */
export function buildEntry(opts: {
  entryNo: number;
  date: string;
  sourceType: SourceType;
  sourceId: string | null;
  memo: string;
  lines: DraftLine[];
  createdBy: string;
  isReversalOf?: string;
}): JournalEntry {
  const lines: JournalLine[] = opts.lines
    .filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0)
    .map((l) => {
      if ((l.debit ?? 0) !== 0 && (l.credit ?? 0) !== 0) {
        throw new Error(`Line for account ${l.accountId} has both debit and credit`);
      }
      return {
        accountId: l.accountId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        contactId: l.contactId,
        branchId: l.branchId,
        description: l.description,
      };
    });

  const debits = sumPaise(lines.map((l) => l.debit));
  const credits = sumPaise(lines.map((l) => l.credit));
  if (debits !== credits) throw new UnbalancedEntryError(debits, credits);
  if (lines.length < 2) throw new Error('A journal entry needs at least two lines');

  return {
    id: genId('je'),
    entryNo: opts.entryNo,
    date: opts.date,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    memo: opts.memo,
    lines,
    isReversalOf: opts.isReversalOf,
    createdAt: new Date().toISOString(),
    createdBy: opts.createdBy,
  };
}

/**
 * Build the reversal of an existing entry (debits⇄credits swapped).
 * This is how voids work — the original is NEVER mutated or removed.
 */
export function buildReversal(
  original: JournalEntry,
  opts: { entryNo: number; date: string; memo: string; createdBy: string },
): JournalEntry {
  return buildEntry({
    entryNo: opts.entryNo,
    date: opts.date,
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    memo: opts.memo,
    createdBy: opts.createdBy,
    isReversalOf: original.id,
    lines: original.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
      contactId: l.contactId,
      branchId: l.branchId,
      description: `Reversal: ${l.description ?? ''}`.trim(),
    })),
  });
}

/** Net balance of one account across entries: +ve = net debit. */
export function accountNet(entries: JournalEntry[], accountId: string): Paise {
  let net = 0;
  for (const e of entries) {
    for (const l of e.lines) {
      if (l.accountId === accountId) net += l.debit - l.credit;
    }
  }
  return net;
}
