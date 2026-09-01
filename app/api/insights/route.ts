import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '@/lib/server/db';
import { route, query } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';
import { trialBalance, ageing } from '@/lib/server/reports/statements';
import { gstr3b } from '@/lib/server/gst/returns';
import { partyBalances } from '@/lib/server/reports/analysis';

// ─────────────────────────────────────────────────────────────────────────────
// Checks and answers over the real books.
//
// Nothing here is a language model. The checks are rules — duplicate supplier
// invoice numbers, invoices past the IRN window, MSME bills near 45 days — run
// against the same tables the reports read. The answers are a router: a
// question maps to a query that already exists, and the figure that comes back
// is the same one the report would show.
//
// That is the honest description, and it is also the useful one. An accounting
// assistant that occasionally invents a number is worse than no assistant, so
// every figure below traces to a document.
// ─────────────────────────────────────────────────────────────────────────────

export interface Flag {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  href: string;
  count: number;
}

const Q = z.object({
  view: z.enum(['flags', 'ask']).default('flags'),
  question: z.string().optional(),
});

async function detectFlags(orgId: number): Promise<Flag[]> {
  const today = new Date().toISOString().slice(0, 10);
  const flags: Flag[] = [];

  const [duplicates, staleIrn, msme, missingHsn, unapplied, negativeStock, unmatched, drafts] =
    await Promise.all([
      // The same supplier invoice number twice is either a double entry or a
      // supplier reusing a number. Both need looking at before the ITC claim.
      sql<{ vendor_id: number; name: string; no: string; n: string }>`
        SELECT b.vendor_id, c.display_name AS name, b.vendor_invoice_no AS no, COUNT(*) AS n
          FROM bills b JOIN contacts c ON c.id = b.vendor_id
         WHERE b.org_id = ${orgId} AND b.status <> 'void'
         GROUP BY b.vendor_id, c.display_name, b.vendor_invoice_no
        HAVING n > 1
      `.execute(db),
      sql<{ n: string }>`
        SELECT COUNT(*) AS n FROM einvoices e
          JOIN invoices i ON i.id = e.invoice_id
         WHERE e.org_id = ${orgId} AND e.status IN ('pending', 'failed')
           AND DATEDIFF(${today}, i.invoice_date) > 23
      `.execute(db),
      sql<{ n: string; v: string }>`
        SELECT COUNT(*) AS n, COALESCE(SUM(b.total - b.amount_paid), 0) AS v
          FROM bills b JOIN contacts c ON c.id = b.vendor_id
         WHERE b.org_id = ${orgId} AND c.is_msme = 1
           AND b.status NOT IN ('draft','void') AND b.total > b.amount_paid
           AND DATEDIFF(${today}, b.bill_date) >= 38
      `.execute(db),
      sql<{ n: string }>`
        SELECT COUNT(*) AS n FROM invoice_lines l
          JOIN invoices i ON i.id = l.invoice_id
         WHERE i.org_id = ${orgId} AND i.status NOT IN ('draft','void')
           AND (l.hsn_sac IS NULL OR l.hsn_sac = '')
      `.execute(db),
      sql<{ n: string; v: string }>`
        SELECT COUNT(*) AS n, COALESCE(SUM(unapplied_amount), 0) AS v
          FROM payments
         WHERE org_id = ${orgId} AND status <> 'void' AND unapplied_amount > 0
      `.execute(db),
      sql<{ n: string }>`
        SELECT COUNT(*) AS n FROM (
          SELECT it.id,
                 it.opening_stock_qty
                 + COALESCE((SELECT SUM(bl.qty) FROM bill_lines bl JOIN bills b ON b.id = bl.bill_id
                              WHERE bl.item_id = it.id AND b.status NOT IN ('draft','void')), 0)
                 - COALESCE((SELECT SUM(il.qty) FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
                              WHERE il.item_id = it.id AND i.status NOT IN ('draft','void')), 0)
                 + COALESCE((SELECT SUM(a.qty_delta) FROM stock_adjustments a
                              WHERE a.item_id = it.id), 0) AS qty
            FROM items it
           WHERE it.org_id = ${orgId} AND it.is_archived = 0 AND it.kind = 'goods'
        ) x WHERE x.qty < 0
      `.execute(db),
      sql<{ n: string }>`
        SELECT COUNT(*) AS n FROM bank_transactions
         WHERE org_id = ${orgId} AND status = 'unmatched'
      `.execute(db),
      sql<{ n: string }>`
        SELECT COUNT(*) AS n FROM invoices WHERE org_id = ${orgId} AND status = 'draft'
      `.execute(db),
    ]);

  const n = (r: { rows: { n: string }[] }) => Number(r.rows[0]?.n ?? 0);

  if (duplicates.rows.length) {
    flags.push({
      id: 'duplicate-bills',
      severity: 'high',
      title: 'The same supplier invoice number appears twice',
      detail:
        `${duplicates.rows.length} supplier invoice number(s) are used on more than one bill — ` +
        `${duplicates.rows.slice(0, 2).map((d) => `${d.name} ${d.no}`).join(', ')}. ` +
        'Either the bill was entered twice, or the supplier reused a number. Both matter: a duplicate claims the input credit twice.',
      href: '/purchases/bills',
      count: duplicates.rows.length,
    });
  }

  if (n(staleIrn)) {
    flags.push({
      id: 'irn-window',
      severity: 'high',
      title: 'The IRN window is closing',
      detail:
        `${n(staleIrn)} invoice(s) are within a week of the 30-day registration deadline. ` +
        'After it the portal refuses them outright, and an invoice without an IRN is not legally valid.',
      href: '/gst/einvoices',
      count: n(staleIrn),
    });
  }

  const msmeRow = msme.rows[0];
  if (Number(msmeRow?.n ?? 0)) {
    flags.push({
      id: 'msme-45',
      severity: 'high',
      title: 'MSME bills near the 45-day limit',
      detail:
        `${msmeRow.n} bill(s) worth ₹${(toPaiseFromSql(msmeRow.v) / 100).toLocaleString('en-IN')} are close to ` +
        'or past 45 days. Under section 43B(h) the expense stops being deductible in this year if they are not paid.',
      href: '/purchases/msme-tracker',
      count: Number(msmeRow.n),
    });
  }

  if (n(missingHsn)) {
    flags.push({
      id: 'missing-hsn',
      severity: 'high',
      title: 'Invoice lines with no HSN/SAC code',
      detail:
        `${n(missingHsn)} line(s) on issued invoices carry no code. GSTR-1 Table 12 is validated against the ` +
        'official master, and one missing code bounces the whole return.',
      href: '/gst/gstr1',
      count: n(missingHsn),
    });
  }

  const unappliedRow = unapplied.rows[0];
  if (Number(unappliedRow?.n ?? 0)) {
    flags.push({
      id: 'unapplied',
      severity: 'medium',
      title: 'Payments sitting on account',
      detail:
        `${unappliedRow.n} payment(s) hold ₹${(toPaiseFromSql(unappliedRow.v) / 100).toLocaleString('en-IN')} ` +
        'that has not been matched to any invoice. The customer looks like they still owe it.',
      href: '/sales/payments',
      count: Number(unappliedRow.n),
    });
  }

  if (n(negativeStock)) {
    flags.push({
      id: 'negative-stock',
      severity: 'medium',
      title: 'Items showing negative stock',
      detail:
        `${n(negativeStock)} item(s) have been invoiced out in greater quantity than was ever recorded coming in. ` +
        'Usually a supplier bill that was never entered.',
      href: '/inventory/stock',
      count: n(negativeStock),
    });
  }

  if (n(unmatched)) {
    flags.push({
      id: 'unreconciled',
      severity: 'medium',
      title: 'Bank lines not reconciled',
      detail:
        `${n(unmatched)} statement line(s) have not been matched to anything. Until they are, the bank balance ` +
        'in the books is not the balance in the bank.',
      href: '/banking/reconcile',
      count: n(unmatched),
    });
  }

  if (n(drafts)) {
    flags.push({
      id: 'drafts',
      severity: 'low',
      title: 'Invoices still in draft',
      detail:
        `${n(drafts)} invoice(s) have never been issued, so nothing has been posted for them and no customer ` +
        'has been asked to pay.',
      href: '/sales/invoices',
      count: n(drafts),
    });
  }

  return flags;
}

/**
 * Answer a question by routing it to a query that already exists.
 *
 * Keyword matching, not language understanding — and it says so when it cannot
 * match. An assistant that guesses at an accounting question is worse than one
 * that admits it did not understand.
 */
async function answer(orgId: number, question: string) {
  const q = question.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const fyStart = `${Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0)}-04-01`;
  const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const has = (...words: string[]) => words.some((w) => q.includes(w));

  if (has('overdue', 'late', 'chase')) {
    const ar = await ageing(db, orgId, 'receivable', today);
    const overdue = Object.entries(ar.totals)
      .filter(([b]) => b !== 'Current')
      .reduce((t, [, v]) => t + v, 0);
    const worst = ar.rows
      .filter((r) => r.totalPaise > 0)
      .sort((a, b) => b.totalPaise - a.totalPaise)
      .slice(0, 5);
    return {
      answer:
        overdue > 0
          ? `${rupees(overdue)} is past its due date, out of ${rupees(ar.grandTotalPaise)} outstanding in total. The largest balances:`
          : `Nothing is overdue. ${rupees(ar.grandTotalPaise)} is outstanding but all of it is still within terms.`,
      rows: worst.map((r) => ({ label: r.name, value: rupees(r.totalPaise) })),
      source: '/reports/ar-ageing',
    };
  }

  if (has('top customer', 'best customer', 'biggest customer', 'who owes')) {
    const rows = await partyBalances(db, orgId, 'customer', { from: fyStart, to: today });
    return {
      answer: `Your largest customers this financial year, by what they have been invoiced:`,
      rows: rows.slice(0, 5).map((r) => ({
        label: r.name,
        value: `${rupees(r.invoicedPaise)} · ${rupees(r.outstandingPaise)} still owed`,
      })),
      source: '/reports/sales-by-customer',
    };
  }

  if (has('gst', 'tax liability', 'owe the government', 'return')) {
    const g = await gstr3b(db, orgId, today.slice(0, 7));
    return {
      answer:
        g.totalCashPaise > 0
          ? `For ${today.slice(0, 7)} you owe ${rupees(g.totalCashPaise)} in cash after setting off input credit.`
          : `For ${today.slice(0, 7)} your input credit covers the whole liability — nothing to pay in cash.`,
      rows: [
        { label: 'Tax collected on sales', value: rupees(g.outward.cgstPaise + g.outward.sgstPaise + g.outward.igstPaise) },
        { label: 'Credit available', value: rupees(g.itc.cgstPaise + g.itc.sgstPaise + g.itc.igstPaise) },
        { label: 'Payable in cash', value: rupees(g.totalCashPaise) },
      ],
      source: '/gst/gstr3b',
    };
  }

  if (has('cash', 'bank balance', 'how much money')) {
    const rows = await db
      .selectFrom('bank_accounts as ba')
      .select([
        'ba.name', 'ba.kind',
        sql<string>`COALESCE((SELECT SUM(jl.debit - jl.credit) FROM journal_lines jl
                               WHERE jl.account_id = ba.ledger_account_id), 0)`.as('bal'),
      ])
      .where('ba.org_id', '=', orgId)
      .where('ba.is_active', '=', 1)
      .execute();
    const total = rows
      .filter((r) => r.kind !== 'card')
      .reduce((t, r) => t + toPaiseFromSql(r.bal), 0);
    return {
      answer: `You have ${rupees(total)} across your bank and cash accounts.`,
      rows: rows.map((r) => ({ label: r.name, value: rupees(toPaiseFromSql(r.bal)) })),
      source: '/banking',
    };
  }

  if (has('profit', 'how am i doing', 'earning')) {
    const tb = await trialBalance(db, orgId, today);
    const income = tb.rows.filter((r) => r.type === 'income').reduce((t, r) => t + r.balancePaise, 0);
    const expense = tb.rows.filter((r) => r.type === 'expense').reduce((t, r) => t + r.balancePaise, 0);
    return {
      answer: `Income of ${rupees(income)} against ${rupees(expense)} of costs — a ${income - expense >= 0 ? 'profit' : 'loss'} of ${rupees(Math.abs(income - expense))}.`,
      rows: [
        { label: 'Income', value: rupees(income) },
        { label: 'Expenses', value: rupees(expense) },
        { label: income - expense >= 0 ? 'Profit' : 'Loss', value: rupees(Math.abs(income - expense)) },
      ],
      source: '/reports/profit-and-loss',
    };
  }

  return {
    answer:
      'I did not understand that one. I can answer questions about overdue invoices, your largest customers, ' +
      'your GST position, your cash, and your profit — each by running the report behind it rather than by ' +
      'guessing.',
    rows: [],
    source: '/reports',
  };
}

export const GET = route(
  async ({ orgId, req }) => {
    const q = query(req, Q);

    if (q.view === 'ask') {
      const result = await answer(orgId, q.question ?? '');
      return { view: 'ask', question: q.question ?? '', ...result };
    }

    const flags = await detectFlags(orgId);
    return {
      view: 'flags',
      flags,
      summary: {
        high: flags.filter((f) => f.severity === 'high').length,
        medium: flags.filter((f) => f.severity === 'medium').length,
        low: flags.filter((f) => f.severity === 'low').length,
      },
    };
  },
  { permission: { module: 'ai', action: 'view' } },
);
