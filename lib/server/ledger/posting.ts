import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// The posting engine. The only code in the backend that writes to
// journal_entries or journal_lines.
//
// It holds the same three invariants as the client engine the MVP was built on,
// enforced here against a real database inside a transaction:
//
//   1. Every entry balances. Debits equal credits, or nothing is written.
//   2. Entries are append-only. There is no update and no delete — a correction
//      is a new entry that reverses the old one and links back to it.
//   3. Each line is one-sided: debit XOR credit, and never zero.
//
// The CHECK constraints in 002_ledger.sql enforce all three at the storage
// layer too. That is not redundancy for its own sake: the constraints make the
// invariants true of the data, while these functions make the failures
// legible — an accountant needs to be told which side is short and by how much,
// not handed "Check constraint 'ck_je_balanced' is violated".
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'kysely';
import type { Paise } from '../../types';
import type { Trx } from '../db';
import { toPaiseFromSql, toSqlFromPaise } from '../money-sql';

export class UnbalancedEntryError extends Error {
  readonly debits: Paise;
  readonly credits: Paise;
  constructor(debits: Paise, credits: Paise) {
    const diff = Math.abs(debits - credits);
    super(
      `Entry does not balance. Debits ${(debits / 100).toFixed(2)} against credits ` +
        `${(credits / 100).toFixed(2)} — a difference of ${(diff / 100).toFixed(2)}. ` +
        'Nothing was posted.',
    );
    this.name = 'UnbalancedEntryError';
    this.debits = debits;
    this.credits = credits;
  }
}

export class PeriodLockedError extends Error {
  constructor(module: string, lockedUpto: string, reason?: string | null) {
    super(
      `${module} is locked up to ${lockedUpto}${reason ? ` — ${reason}` : ''}. ` +
        'Nothing dated on or before that can be posted, changed or voided.',
    );
    this.name = 'PeriodLockedError';
  }
}

export type LockModule = 'sales' | 'purchases' | 'banking' | 'accountant';

export interface DraftLine {
  accountId: number;
  debit?: Paise;
  credit?: Paise;
  contactId?: number | null;
  description?: string | null;
}

export interface PostEntryInput {
  orgId: number;
  branchId: number;
  date: string; // yyyy-mm-dd
  memo?: string | null;
  sourceType: string;
  sourceId?: number | null;
  lines: DraftLine[];
  userId?: number | null;
  /** Which lock to honour. Omit only for opening balances during onboarding. */
  module?: LockModule;
  reversalOfEntryId?: number | null;
}

export interface PostedEntry {
  id: number;
  entryNo: number;
  totalDebit: Paise;
  totalCredit: Paise;
}

/**
 * Refuse to post into a closed period.
 *
 * Once a GST return is filed the figures behind it are public. If someone then
 * backdates a document into that period, the filed return and the books stop
 * agreeing and nobody finds out until an assessment. The lock makes that
 * impossible rather than merely discouraged.
 */
export async function assertPeriodOpen(
  trx: Trx,
  orgId: number,
  module: LockModule,
  date: string,
): Promise<void> {
  const lock = await trx
    .selectFrom('transaction_locks')
    .select(['locked_upto', 'reason'])
    .where('org_id', '=', orgId)
    .where('module', '=', module)
    .executeTakeFirst();

  if (!lock?.locked_upto) return;
  const lockedUpto = String(lock.locked_upto).slice(0, 10);
  if (date <= lockedUpto) throw new PeriodLockedError(module, lockedUpto, lock.reason);
}

/**
 * Allocate the next document number for a branch and financial year.
 *
 * Takes a row lock, so two people saving an invoice in the same second cannot
 * be handed the same number. A duplicate invoice number inside one GSTIN is a
 * GSTR-1 rejection, not a cosmetic clash, which is why this is a locked read
 * rather than a MAX(number) + 1.
 */
export async function allocateNumber(
  trx: Trx,
  orgId: number,
  branchId: number,
  docType: string,
  fyLabel: string,
  defaults: { prefix: string; padding?: number } = { prefix: docType },
): Promise<string> {
  // Same order as nextSequence, and for the same reason: locking a row that
  // does not exist yet locks the gap around it, and two people starting
  // different series in a new financial year would deadlock on each other.
  const updated = await trx
    .updateTable('number_series')
    .set((eb) => ({ next_number: eb('next_number', '+', 1) }))
    .where('org_id', '=', orgId)
    .where('branch_id', '=', branchId)
    .where('doc_type', '=', docType)
    .where('fy_label', '=', fyLabel)
    .executeTakeFirst();

  if (Number(updated.numUpdatedRows ?? 0) > 0) {
    const row = await trx
      .selectFrom('number_series')
      .select(['prefix', 'next_number', 'padding'])
      .where('org_id', '=', orgId)
      .where('branch_id', '=', branchId)
      .where('doc_type', '=', docType)
      .where('fy_label', '=', fyLabel)
      .executeTakeFirstOrThrow();
    return format(row.prefix, fyLabel, row.next_number - 1, row.padding);
  }

  const padding = defaults.padding ?? 4;
  try {
    await trx
      .insertInto('number_series')
      .values({
        org_id: orgId,
        branch_id: branchId,
        doc_type: docType,
        fy_label: fyLabel,
        prefix: defaults.prefix,
        next_number: 2,
        padding,
      })
      .execute();
    return format(defaults.prefix, fyLabel, 1, padding);
  } catch (err) {
    if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err;
    return allocateNumber(trx, orgId, branchId, docType, fyLabel, defaults);
  }
}

/**
 * Allocate a document number that is unique across the whole organisation.
 *
 * Invoices, quotes and the rest are numbered per GST registration, because the
 * law requires each registration to keep its own unbroken series. Bills,
 * receipts and expenses are internal documents with no such rule, and their
 * tables enforce uniqueness per organisation — so numbering them per branch
 * hands two branches the same number and the second insert fails.
 */
export async function allocateOrgNumber(
  trx: Trx,
  orgId: number,
  docType: string,
  fyLabel: string,
  prefix: string,
  padding = 4,
): Promise<string> {
  const n = await nextSequence(trx, orgId, `${docType}:${fyLabel}`);
  return format(prefix, fyLabel, n, padding);
}

/** INV/26-27/0042 — prefix, financial year, zero-padded sequence. */
function format(prefix: string, fyLabel: string, n: number, padding: number): string {
  return `${prefix}/${fyLabel}/${String(n).padStart(padding, '0')}`;
}

/**
 * Take the next value from a named per-organisation counter.
 *
 * One row, one lock. The obvious alternative — SELECT MAX(entry_no) + 1 ...
 * FOR UPDATE — is correct in isolation and deadlocks under load, because
 * FOR UPDATE on an aggregate takes next-key locks across everything InnoDB
 * scans and two concurrent posts can each end up holding part of what the
 * other needs.
 */
export async function nextSequence(trx: Trx, orgId: number, name: string): Promise<number> {
  // Update first, insert only if there was nothing to update.
  //
  // The obvious order — SELECT ... FOR UPDATE, then INSERT if missing — takes a
  // *gap* lock when the row does not exist yet, covering the whole index range
  // rather than one row. Two transactions creating different counters in the
  // same range then deadlock on each other's gaps. Updating first locks exactly
  // one existing row and nothing else.
  const updated = await trx
    .updateTable('sequences')
    .set((eb) => ({ next_value: eb('next_value', '+', 1) }))
    .where('org_id', '=', orgId)
    .where('name', '=', name)
    .executeTakeFirst();

  if (Number(updated.numUpdatedRows ?? 0) > 0) {
    const row = await trx
      .selectFrom('sequences')
      .select('next_value')
      .where('org_id', '=', orgId)
      .where('name', '=', name)
      .executeTakeFirstOrThrow();
    // We already incremented, so the value we took is one below what is stored.
    return Number(row.next_value) - 1;
  }

  // First use of this counter. A concurrent transaction may be inserting the
  // same row right now; if it wins, the duplicate-key error sends us back to
  // the update path rather than failing the caller's work.
  try {
    await trx
      .insertInto('sequences')
      .values({ org_id: orgId, name, next_value: 2 })
      .execute();
    return 1;
  } catch (err) {
    if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err;
    return nextSequence(trx, orgId, name);
  }
}

/** Peek at the next number without consuming it, for a form's default value. */
export async function peekNumber(
  trx: Trx,
  orgId: number,
  branchId: number,
  docType: string,
  fyLabel: string,
  fallbackPrefix: string,
): Promise<string> {
  const row = await trx
    .selectFrom('number_series')
    .select(['prefix', 'next_number', 'padding'])
    .where('org_id', '=', orgId)
    .where('branch_id', '=', branchId)
    .where('doc_type', '=', docType)
    .where('fy_label', '=', fyLabel)
    .executeTakeFirst();
  return row
    ? format(row.prefix, fyLabel, row.next_number, row.padding)
    : format(fallbackPrefix, fyLabel, 1, 4);
}

/**
 * Peek at the next org-wide number without consuming it.
 *
 * The mirror of peekNumber for documents numbered once per organisation rather
 * than per branch — bills, expenses, receipts, payments, retainers.
 */
export async function peekOrgNumber(
  trx: Trx,
  orgId: number,
  docType: string,
  fyLabel: string,
  prefix: string,
  padding = 4,
): Promise<string> {
  const row = await trx
    .selectFrom('sequences')
    .select('next_value')
    .where('org_id', '=', orgId)
    .where('name', '=', `${docType}:${fyLabel}`)
    .executeTakeFirst();
  return format(prefix, fyLabel, Number(row?.next_value ?? 1), padding);
}

/**
 * Validate and write one journal entry.
 *
 * Must be called inside a transaction. The caller composes the document write
 * and this posting into a single atomic unit, so an invoice can never exist
 * without its entry — nor an entry without its invoice.
 */
export async function postEntry(trx: Trx, input: PostEntryInput): Promise<PostedEntry> {
  if (input.module) await assertPeriodOpen(trx, input.orgId, input.module, input.date);

  // Drop no-op lines before validating. A zero line carries no information and
  // would trip the storage constraint for no useful reason.
  const lines = input.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);

  for (const l of lines) {
    const debit = l.debit ?? 0;
    const credit = l.credit ?? 0;
    if (debit !== 0 && credit !== 0) {
      throw new Error(
        `A line cannot be both a debit and a credit (account ${l.accountId}). ` +
          'Split it into two lines.',
      );
    }
    if (debit < 0 || credit < 0) {
      throw new Error(
        `Negative amounts are not postable (account ${l.accountId}). ` +
          'Post the opposite side instead — that is what the other column is for.',
      );
    }
    if (!Number.isInteger(debit) || !Number.isInteger(credit)) {
      throw new TypeError(`Amounts must be whole paise (account ${l.accountId}).`);
    }
  }

  const totalDebit = lines.reduce((t, l) => t + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((t, l) => t + (l.credit ?? 0), 0);
  if (totalDebit !== totalCredit) throw new UnbalancedEntryError(totalDebit, totalCredit);
  if (lines.length < 2) {
    throw new Error(
      'A journal entry needs at least two lines. Every transaction moves value ' +
        'from somewhere to somewhere else — a one-sided entry is a missing half.',
    );
  }

  const next = await nextSequence(trx, input.orgId, 'journal_entry');

  const entry = await trx
    .insertInto('journal_entries')
    .values({
      org_id: input.orgId,
      branch_id: input.branchId,
      entry_no: next,
      entry_date: input.date,
      memo: input.memo ?? null,
      source_type: input.sourceType,
      source_id: input.sourceId ?? null,
      reversal_of_entry_id: input.reversalOfEntryId ?? null,
      total_debit: toSqlFromPaise(totalDebit),
      total_credit: toSqlFromPaise(totalCredit),
      posted_by_user_id: input.userId ?? null,
    })
    .executeTakeFirstOrThrow();

  const entryId = Number(entry.insertId);

  await trx
    .insertInto('journal_lines')
    .values(
      lines.map((l, i) => ({
        entry_id: entryId,
        org_id: input.orgId,
        line_no: i + 1,
        account_id: l.accountId,
        debit: toSqlFromPaise(l.debit ?? 0),
        credit: toSqlFromPaise(l.credit ?? 0),
        description: l.description ?? null,
        entry_date: input.date,
        contact_id: l.contactId ?? null,
      })),
    )
    .execute();

  return { id: entryId, entryNo: next, totalDebit, totalCredit };
}

/**
 * Post the mirror image of an existing entry.
 *
 * This is how anything is undone. The original stays exactly as posted and the
 * reversal sits next to it, so the history shows both what was recorded and
 * that it was corrected — which is the whole point of an audit trail. Deleting
 * the original would leave no evidence it ever existed.
 */
export async function reverseEntry(
  trx: Trx,
  orgId: number,
  entryId: number,
  opts: { date?: string; memo?: string; userId?: number | null; module?: LockModule } = {},
): Promise<PostedEntry> {
  const original = await trx
    .selectFrom('journal_entries')
    .selectAll()
    .where('id', '=', entryId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();

  if (!original) throw new Error(`Journal entry ${entryId} not found`);

  const already = await trx
    .selectFrom('journal_entries')
    .select('id')
    .where('reversal_of_entry_id', '=', entryId)
    .executeTakeFirst();
  if (already) {
    throw new Error(
      `Entry ${original.entry_no} has already been reversed by entry ${already.id}. ` +
        'Reversing it twice would double the correction.',
    );
  }

  const lines = await trx
    .selectFrom('journal_lines')
    .select(['account_id', 'debit', 'credit', 'description', 'contact_id'])
    .where('entry_id', '=', entryId)
    .orderBy('line_no')
    .execute();

  return postEntry(trx, {
    orgId,
    branchId: original.branch_id,
    // Reversals default to the original date so the period they affect is the
    // period they came from. Passing a date moves the correction into an open
    // period instead, which is what you want once the original month is filed.
    date: opts.date ?? String(original.entry_date).slice(0, 10),
    memo: opts.memo ?? `Reversal of entry ${original.entry_no}`,
    sourceType: original.source_type,
    sourceId: original.source_id,
    reversalOfEntryId: entryId,
    userId: opts.userId ?? null,
    module: opts.module,
    // Debit becomes credit and credit becomes debit. Nothing else changes.
    lines: lines.map((l) => ({
      accountId: l.account_id,
      debit: toPaiseFromSql(l.credit),
      credit: toPaiseFromSql(l.debit),
      contactId: l.contact_id,
      description: l.description,
    })),
  });
}

/**
 * Prove the whole ledger balances. Used by the health check and the tests —
 * if this ever returns false, something has written to the tables directly.
 */
export async function verifyLedgerBalances(
  trx: Trx,
  orgId: number,
): Promise<{ balanced: boolean; totalDebit: Paise; totalCredit: Paise; unbalancedEntries: number }> {
  const { rows } = await sql<{ dr: string; cr: string }>`
    SELECT COALESCE(SUM(debit), 0) AS dr, COALESCE(SUM(credit), 0) AS cr
    FROM journal_lines WHERE org_id = ${orgId}
  `.execute(trx);

  const { rows: bad } = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM (
      SELECT l.entry_id
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.org_id = ${orgId}
      GROUP BY l.entry_id, e.total_debit, e.total_credit
      HAVING SUM(l.debit) <> e.total_debit OR SUM(l.credit) <> e.total_credit
    ) x
  `.execute(trx);

  const totalDebit = toPaiseFromSql(rows[0]?.dr ?? '0');
  const totalCredit = toPaiseFromSql(rows[0]?.cr ?? '0');
  const unbalancedEntries = Number(bad[0]?.n ?? 0);

  return {
    balanced: totalDebit === totalCredit && unbalancedEntries === 0,
    totalDebit,
    totalCredit,
    unbalancedEntries,
  };
}
