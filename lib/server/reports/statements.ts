import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// Financial statements, computed in SQL from journal_lines.
//
// Nothing here is stored. Every figure is derived from the journal on each
// request, which is why two reports can never disagree — there is no cached
// total to fall out of date, and no "rebuild balances" job to forget to run.
//
// Aggregation happens in the database rather than in JavaScript. A year of a
// real book is hundreds of thousands of lines; shipping them to the server
// process to be summed would be slow long before it was wrong.
//
// One rule runs through all of it: which side increases an account depends on
// its type. Assets and expenses grow with debits, everything else with credits.
// Getting that backwards flips the sign of half the report and it still adds
// up, which is what makes it hard to spot.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'kysely';
import type { Executor } from '../db';
import type { Paise } from '../../types';
import { toPaiseFromSql } from '../money-sql';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

/** True when debits increase the account. */
export const isDebitNormal = (type: AccountType): boolean =>
  type === 'asset' || type === 'expense';

export interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  debitPaise: Paise;
  creditPaise: Paise;
  /** Signed in the account's own direction: positive means a normal balance. */
  balancePaise: Paise;
}

interface RawBalance {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  dr: string;
  cr: string;
}

/**
 * Every account's movement between two dates.
 *
 * `from` is optional: a balance sheet wants everything up to a date, while a
 * profit and loss wants only the period. That difference is the whole reason
 * the two reports exist — one is a position, the other is a performance.
 */
async function balances(
  ex: Executor,
  orgId: number,
  opts: { from?: string; to: string; branchId?: number },
): Promise<AccountBalance[]> {
  const from = opts.from ?? '1900-01-01';
  const branchFilter = opts.branchId
    ? sql`AND e.branch_id = ${opts.branchId}`
    : sql``;

  const { rows } = await sql<RawBalance>`
    SELECT a.id, a.code, a.name, a.type, a.subtype,
           COALESCE(SUM(jl.debit), 0)  AS dr,
           COALESCE(SUM(jl.credit), 0) AS cr
      FROM accounts a
      LEFT JOIN journal_lines jl
        ON jl.account_id = a.id
       AND jl.entry_date BETWEEN ${from} AND ${opts.to}
      LEFT JOIN journal_entries e ON e.id = jl.entry_id
     WHERE a.org_id = ${orgId} ${branchFilter}
     GROUP BY a.id, a.code, a.name, a.type, a.subtype
     ORDER BY a.code
  `.execute(ex);

  return rows.map((r) => {
    const debitPaise = toPaiseFromSql(r.dr);
    const creditPaise = toPaiseFromSql(r.cr);
    return {
      accountId: String(r.id),
      code: r.code,
      name: r.name,
      type: r.type,
      subtype: r.subtype,
      debitPaise,
      creditPaise,
      balancePaise: isDebitNormal(r.type) ? debitPaise - creditPaise : creditPaise - debitPaise,
    };
  });
}

// ── Trial balance ────────────────────────────────────────────────────────────

export interface TrialBalance {
  rows: (AccountBalance & { debitSide: Paise; creditSide: Paise })[];
  totalDebit: Paise;
  totalCredit: Paise;
  balanced: boolean;
}

/**
 * The proof that the books tie.
 *
 * Every account with a balance, on whichever side it naturally falls. The two
 * columns must agree exactly — not approximately — because every entry was
 * balanced when it was posted, so their sum has to be.
 */
export async function trialBalance(
  ex: Executor,
  orgId: number,
  asOf: string,
  branchId?: number,
): Promise<TrialBalance> {
  const all = await balances(ex, orgId, { to: asOf, branchId });

  const rows = all
    .filter((r) => r.debitPaise !== 0 || r.creditPaise !== 0)
    .map((r) => {
      const net = r.debitPaise - r.creditPaise;
      return { ...r, debitSide: net > 0 ? net : 0, creditSide: net < 0 ? -net : 0 };
    });

  const totalDebit = rows.reduce((t, r) => t + r.debitSide, 0);
  const totalCredit = rows.reduce((t, r) => t + r.creditSide, 0);

  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

// ── Profit and loss ──────────────────────────────────────────────────────────

export interface ProfitAndLoss {
  incomeRows: AccountBalance[];
  expenseRows: AccountBalance[];
  totalIncome: Paise;
  totalExpense: Paise;
  grossProfit: Paise;
  netProfit: Paise;
  from: string;
  to: string;
}

/** Income less expenses for a period. Did we make money? */
export async function profitAndLoss(
  ex: Executor,
  orgId: number,
  from: string,
  to: string,
  branchId?: number,
): Promise<ProfitAndLoss> {
  const all = await balances(ex, orgId, { from, to, branchId });

  const incomeRows = all.filter((r) => r.type === 'income' && r.balancePaise !== 0);
  const expenseRows = all.filter((r) => r.type === 'expense' && r.balancePaise !== 0);

  const totalIncome = incomeRows.reduce((t, r) => t + r.balancePaise, 0);
  const totalExpense = expenseRows.reduce((t, r) => t + r.balancePaise, 0);

  // Direct costs — what the goods themselves cost — separated from overheads,
  // because the margin on trading is a different question from whether the
  // business covers its rent.
  const directCodes = new Set(['5100', '5200', '5300']);
  const directCost = expenseRows
    .filter((r) => directCodes.has(r.code))
    .reduce((t, r) => t + r.balancePaise, 0);

  return {
    incomeRows,
    expenseRows,
    totalIncome,
    totalExpense,
    grossProfit: totalIncome - directCost,
    netProfit: totalIncome - totalExpense,
    from,
    to,
  };
}

// ── Balance sheet ────────────────────────────────────────────────────────────

export interface BalanceSheet {
  assetRows: AccountBalance[];
  liabilityRows: AccountBalance[];
  equityRows: AccountBalance[];
  totalAssets: Paise;
  totalLiabilities: Paise;
  totalEquity: Paise;
  /** Profit not yet moved to retained earnings; part of what the owners hold. */
  currentPeriodEarnings: Paise;
  balanced: boolean;
  asOf: string;
}

/**
 * What the business owns and owes on a single date.
 *
 * Assets must equal liabilities plus equity. The piece people miss is current
 * period earnings: profit earned this year has not been moved into retained
 * earnings yet, but it belongs to the owners all the same, and leaving it out
 * makes the sheet fail to balance by exactly the year's profit.
 */
export async function balanceSheet(
  ex: Executor,
  orgId: number,
  asOf: string,
  branchId?: number,
): Promise<BalanceSheet> {
  const all = await balances(ex, orgId, { to: asOf, branchId });

  const assetRows = all.filter((r) => r.type === 'asset' && r.balancePaise !== 0);
  const liabilityRows = all.filter((r) => r.type === 'liability' && r.balancePaise !== 0);
  const equityRows = all.filter((r) => r.type === 'equity' && r.balancePaise !== 0);

  const income = all.filter((r) => r.type === 'income').reduce((t, r) => t + r.balancePaise, 0);
  const expense = all.filter((r) => r.type === 'expense').reduce((t, r) => t + r.balancePaise, 0);
  const currentPeriodEarnings = income - expense;

  const totalAssets = assetRows.reduce((t, r) => t + r.balancePaise, 0);
  const totalLiabilities = liabilityRows.reduce((t, r) => t + r.balancePaise, 0);
  const totalEquity = equityRows.reduce((t, r) => t + r.balancePaise, 0) + currentPeriodEarnings;

  return {
    assetRows,
    liabilityRows,
    equityRows,
    totalAssets,
    totalLiabilities,
    totalEquity,
    currentPeriodEarnings,
    balanced: totalAssets === totalLiabilities + totalEquity,
    asOf,
  };
}

// ── General ledger ───────────────────────────────────────────────────────────

export interface LedgerLine {
  entryId: string;
  entryNo: number;
  date: string;
  memo: string | null;
  description: string | null;
  sourceType: string;
  debitPaise: Paise;
  creditPaise: Paise;
  runningPaise: Paise;
  contactName: string | null;
}

/** One account, in order, with a running balance — how an auditor reads it. */
export async function generalLedger(
  ex: Executor,
  orgId: number,
  accountId: number,
  from: string,
  to: string,
): Promise<{ openingPaise: Paise; lines: LedgerLine[]; closingPaise: Paise }> {
  const account = await ex
    .selectFrom('accounts').select(['id', 'type'])
    .where('id', '=', accountId).where('org_id', '=', orgId).executeTakeFirst();
  if (!account) throw new Error('Account not found.');

  const debitNormal = isDebitNormal(account.type as AccountType);

  const { rows: opening } = await sql<{ dr: string; cr: string }>`
    SELECT COALESCE(SUM(debit), 0) AS dr, COALESCE(SUM(credit), 0) AS cr
      FROM journal_lines
     WHERE org_id = ${orgId} AND account_id = ${accountId} AND entry_date < ${from}
  `.execute(ex);

  const openingDr = toPaiseFromSql(opening[0]?.dr ?? '0');
  const openingCr = toPaiseFromSql(opening[0]?.cr ?? '0');
  const openingPaise = debitNormal ? openingDr - openingCr : openingCr - openingDr;

  const rows = await ex
    .selectFrom('journal_lines')
    .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.entry_id')
    .leftJoin('contacts', 'contacts.id', 'journal_lines.contact_id')
    .select([
      'journal_lines.entry_id', 'journal_lines.debit', 'journal_lines.credit',
      'journal_lines.description', 'journal_lines.entry_date',
      'journal_entries.entry_no', 'journal_entries.memo', 'journal_entries.source_type',
      'contacts.display_name as contact_name',
    ])
    .where('journal_lines.org_id', '=', orgId)
    .where('journal_lines.account_id', '=', accountId)
    .where('journal_lines.entry_date', '>=', from)
    .where('journal_lines.entry_date', '<=', to)
    .orderBy('journal_lines.entry_date')
    .orderBy('journal_entries.entry_no')
    .execute();

  let running = openingPaise;
  const lines: LedgerLine[] = rows.map((r) => {
    const debitPaise = toPaiseFromSql(r.debit);
    const creditPaise = toPaiseFromSql(r.credit);
    running += debitNormal ? debitPaise - creditPaise : creditPaise - debitPaise;
    return {
      entryId: String(r.entry_id),
      entryNo: r.entry_no,
      date: r.entry_date,
      memo: r.memo,
      description: r.description,
      sourceType: r.source_type,
      debitPaise,
      creditPaise,
      runningPaise: running,
      contactName: r.contact_name,
    };
  });

  return { openingPaise, lines, closingPaise: running };
}

// ── Ageing ───────────────────────────────────────────────────────────────────

export const AGEING_BUCKETS = ['Current', '1–15', '16–30', '31–45', '46–60', '60+'] as const;

export interface AgeingRow {
  contactId: string;
  name: string;
  buckets: Record<string, Paise>;
  totalPaise: Paise;
}

/**
 * Receivables or payables, aged from the due date.
 *
 * From the *due* date, not the document date: an invoice on sixty-day terms is
 * not overdue on day thirty, and ageing it from when it was raised would show a
 * collections problem that does not exist.
 */
export async function ageing(
  ex: Executor,
  orgId: number,
  side: 'receivable' | 'payable',
  asOf: string,
): Promise<{ rows: AgeingRow[]; totals: Record<string, Paise>; grandTotalPaise: Paise }> {
  const { rows } = side === 'receivable'
    ? await sql<{ contact_id: number; name: string; due_date: string; balance: string }>`
        SELECT i.customer_id AS contact_id, c.display_name AS name,
               i.due_date, (i.total - i.amount_paid) AS balance
          FROM invoices i
          JOIN contacts c ON c.id = i.customer_id
         WHERE i.org_id = ${orgId} AND i.status NOT IN ('void', 'draft')
           AND i.total > i.amount_paid AND i.invoice_date <= ${asOf}
      `.execute(ex)
    : await sql<{ contact_id: number; name: string; due_date: string; balance: string }>`
        SELECT b.vendor_id AS contact_id, c.display_name AS name,
               b.due_date, (b.total - b.amount_paid) AS balance
          FROM bills b
          JOIN contacts c ON c.id = b.vendor_id
         WHERE b.org_id = ${orgId} AND b.status NOT IN ('void', 'draft')
           AND b.total > b.amount_paid AND b.bill_date <= ${asOf}
      `.execute(ex);

  const byContact = new Map<number, AgeingRow>();
  const totals: Record<string, Paise> = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0]));

  for (const r of rows) {
    const days = Math.floor(
      (new Date(asOf).getTime() - new Date(String(r.due_date).slice(0, 10)).getTime()) / 86_400_000,
    );
    const bucket =
      days <= 0 ? 'Current'
      : days <= 15 ? '1–15'
      : days <= 30 ? '16–30'
      : days <= 45 ? '31–45'
      : days <= 60 ? '46–60'
      : '60+';

    const balance = toPaiseFromSql(r.balance);
    const row = byContact.get(r.contact_id) ?? {
      contactId: String(r.contact_id),
      name: r.name,
      buckets: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])),
      totalPaise: 0,
    };
    row.buckets[bucket] += balance;
    row.totalPaise += balance;
    byContact.set(r.contact_id, row);
    totals[bucket] += balance;
  }

  const out = [...byContact.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  return {
    rows: out,
    totals,
    grandTotalPaise: out.reduce((t, r) => t + r.totalPaise, 0),
  };
}
