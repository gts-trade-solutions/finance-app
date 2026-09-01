import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '@/lib/server/db';
import { route, query } from '@/lib/server/http';
import { trialBalance } from '@/lib/server/reports/statements';

// ─────────────────────────────────────────────────────────────────────────────
// Period-close readiness.
//
// Every count here is a live query, not a stored checklist somebody ticks off.
// A checklist you tick is a record of what you believed at the time; these are
// what is actually true right now, which is the only version worth blocking a
// close on.
//
// The close itself is a transaction lock — this endpoint only reports whether
// it is safe to apply one. See /api/transaction-locks.
// ─────────────────────────────────────────────────────────────────────────────

const Q = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const GET = route(
  async ({ orgId, req }) => {
    const q = query(req, Q);

    const count = async (fn: () => Promise<{ n: string } | undefined>) => Number((await fn())?.n ?? 0);

    const [tb, unreconciled, drafts, noIrn, itcRisk, unapplied, openBills] = await Promise.all([
      trialBalance(db, orgId, q.to),
      count(() =>
        db.selectFrom('bank_transactions')
          .select(sql<string>`COUNT(*)`.as('n'))
          .where('org_id', '=', orgId)
          .where('status', '=', 'unmatched')
          .where('txn_date', '<=', q.to)
          .executeTakeFirst(),
      ),
      count(() =>
        db.selectFrom('invoices')
          .select(sql<string>`COUNT(*)`.as('n'))
          .where('org_id', '=', orgId).where('status', '=', 'draft')
          .where('invoice_date', '<=', q.to).executeTakeFirst(),
      ),
      count(() =>
        db.selectFrom('einvoices')
          .innerJoin('invoices', 'invoices.id', 'einvoices.invoice_id')
          .select(sql<string>`COUNT(*)`.as('n'))
          .where('einvoices.org_id', '=', orgId)
          .where('einvoices.status', 'in', ['pending', 'failed'])
          .where('invoices.invoice_date', '<=', q.to)
          .executeTakeFirst(),
      ),
      count(() =>
        db.selectFrom('gstr2b_entries')
          .select(sql<string>`COUNT(*)`.as('n'))
          .where('org_id', '=', orgId)
          .where('match_status', '<>', 'matched')
          .executeTakeFirst(),
      ),
      count(() =>
        db.selectFrom('payments')
          .select(sql<string>`COUNT(*)`.as('n'))
          .where('org_id', '=', orgId).where('status', '<>', 'void')
          .where('unapplied_amount', '>', '0')
          .where('payment_date', '<=', q.to).executeTakeFirst(),
      ),
      count(() =>
        db.selectFrom('bills')
          .select(sql<string>`COUNT(*)`.as('n'))
          .where('org_id', '=', orgId).where('status', '=', 'draft')
          .where('bill_date', '<=', q.to).executeTakeFirst(),
      ),
    ]);

    const checks = [
      {
        id: 'balance',
        label: 'Trial balance agrees',
        detail: tb.balanced
          ? 'Debits and credits match to the paisa.'
          : 'The books do not balance — this must be fixed before closing.',
        count: tb.balanced ? 0 : 1,
        href: '/reports/trial-balance',
        blocking: true,
      },
      {
        id: 'recon',
        label: 'Bank accounts reconciled',
        detail: unreconciled
          ? `${unreconciled} statement line(s) still unmatched.`
          : 'Every bank line is accounted for.',
        count: unreconciled,
        href: '/banking/reconcile',
        blocking: true,
      },
      {
        id: 'irn',
        label: 'E-invoices registered',
        detail: noIrn
          ? `${noIrn} invoice(s) have no IRN. The 30-day window applies.`
          : 'Every B2B invoice carries a valid IRN.',
        count: noIrn,
        href: '/gst/einvoices',
        blocking: true,
      },
      {
        id: 'drafts',
        label: 'No draft invoices left',
        detail: drafts
          ? `${drafts} invoice(s) still in draft and not posted.`
          : 'All invoices are approved and posted.',
        count: drafts,
        href: '/sales/invoices',
        blocking: false,
      },
      {
        id: 'draft-bills',
        label: 'No draft bills left',
        detail: openBills
          ? `${openBills} supplier bill(s) still in draft.`
          : 'Every bill received has been entered.',
        count: openBills,
        href: '/purchases/bills',
        blocking: false,
      },
      {
        id: 'itc',
        label: 'Input credit reconciled to GSTR-2B',
        detail: itcRisk
          ? `${itcRisk} mismatch(es) between your books and the government's record.`
          : 'Books agree with GSTR-2B.',
        count: itcRisk,
        href: '/gst/itc-reconciliation',
        blocking: false,
      },
      {
        id: 'unapplied',
        label: 'Payments fully applied',
        detail: unapplied
          ? `${unapplied} payment(s) sitting on account, not matched to an invoice.`
          : 'No unapplied receipts.',
        count: unapplied,
        href: '/sales/payments',
        blocking: false,
      },
    ];

    return {
      from: q.from,
      to: q.to,
      checks,
      passed: checks.filter((c) => c.count === 0).length,
      blockers: checks.filter((c) => c.blocking && c.count > 0).length,
    };
  },
  { permission: { module: 'accountant', action: 'view' } },
);
