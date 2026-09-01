import { sql } from 'kysely';
import { db } from '@/lib/server/db';
import { route } from '@/lib/server/http';
import { hasPermission } from '@/lib/rbac';

// ─────────────────────────────────────────────────────────────────────────────
// The three numbers on the navigation rail.
//
// They used to be counted in the browser, over a seeded copy of the book. That
// worked while the store was the book; now that the ledger is in a database it
// would mean shipping every invoice and bank line to the client to count them,
// so they are counted where they live — three aggregates, no rows returned.
//
// Each is a piece of unfinished work with a deadline attached, which is the
// only kind of number worth putting on a navigation item:
//
//   einvoicePending  invoices with no IRN yet. The window is 30 days from the
//                    invoice date; after that the portal refuses it and the
//                    invoice has to be cancelled and reissued.
//   unmatched        statement lines not yet reconciled against the books.
//   msmeRisk         unpaid bills from micro and small suppliers at or past
//                    day 38 of the 45 the law allows (Section 43B(h)).
// ─────────────────────────────────────────────────────────────────────────────

/** Show the MSME badge from a week out, so it is a warning and not a post-mortem. */
const MSME_WARN_FROM_DAY = 38;

export const GET = route(async ({ orgId, role }) => {
  const today = new Date().toISOString().slice(0, 10);

  const [einvoice, bank, msme] = await Promise.all([
    hasPermission(role, 'gst', 'view')
      ? db
          .selectFrom('einvoices')
          .select(({ fn }) => fn.countAll<number>().as('n'))
          .where('org_id', '=', orgId)
          .where('status', 'in', ['pending', 'failed'])
          .executeTakeFirst()
      : null,

    hasPermission(role, 'banking', 'view')
      ? db
          .selectFrom('bank_transactions')
          .select(({ fn }) => fn.countAll<number>().as('n'))
          .where('org_id', '=', orgId)
          .where('status', '=', 'unmatched')
          .executeTakeFirst()
      : null,

    hasPermission(role, 'purchases', 'view')
      ? db
          .selectFrom('bills')
          .innerJoin('contacts', 'contacts.id', 'bills.vendor_id')
          .select(({ fn }) => fn.countAll<number>().as('n'))
          .where('bills.org_id', '=', orgId)
          .where('contacts.is_msme', '=', 1)
          .where('bills.status', 'not in', ['draft', 'void'])
          .whereRef('bills.total', '>', 'bills.amount_paid')
          .where(sql<boolean>`DATEDIFF(${today}, bills.bill_date) >= ${MSME_WARN_FROM_DAY}`)
          .executeTakeFirst()
      : null,
  ]);

  return {
    einvoicePending: Number(einvoice?.n ?? 0),
    unmatched: Number(bank?.n ?? 0),
    msmeRisk: Number(msme?.n ?? 0),
  };
});
