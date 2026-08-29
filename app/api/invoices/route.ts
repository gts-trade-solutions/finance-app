import { z } from 'zod';
import { sql } from 'kysely';
import { db, transaction } from '@/lib/server/db';
import { route, body, query, asId } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';
import { createInvoice } from '@/lib/server/services/sales';
import { logAudit, auditMeta } from '@/lib/server/audit';

const ListQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.string().optional(),
  customerId: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * The list screen's data.
 *
 * Filtering happens in SQL rather than in the browser. The MVP could hold every
 * invoice in memory because there were thirty of them; a real book has tens of
 * thousands, and shipping them all to filter client-side would be slow long
 * before it was wrong.
 */
export const GET = route(
  async ({ orgId, req }) => {
    const q = query(req, ListQuery);

    let base = db
      .selectFrom('invoices')
      .innerJoin('contacts', 'contacts.id', 'invoices.customer_id')
      .where('invoices.org_id', '=', orgId);

    if (q.from) base = base.where('invoices.invoice_date', '>=', q.from);
    if (q.to) base = base.where('invoices.invoice_date', '<=', q.to);
    if (q.status && q.status !== 'all') base = base.where('invoices.status', '=', q.status as never);
    if (q.customerId) base = base.where('invoices.customer_id', '=', Number(q.customerId));
    if (q.search) {
      const term = `%${q.search}%`;
      base = base.where((eb) =>
        eb.or([eb('invoices.number', 'like', term), eb('contacts.display_name', 'like', term)]),
      );
    }

    const [rows, totals] = await Promise.all([
      base
        .select([
          'invoices.id', 'invoices.number', 'invoices.invoice_date', 'invoices.due_date',
          'invoices.status', 'invoices.supply_type', 'invoices.supply_kind',
          'invoices.subtotal', 'invoices.total', 'invoices.amount_paid',
          'invoices.customer_id', 'invoices.branch_id',
          'contacts.display_name as customer_name',
        ])
        .orderBy('invoices.invoice_date', 'desc')
        .orderBy('invoices.id', 'desc')
        .limit(q.limit)
        .offset(q.offset)
        .execute(),
      base
        .select([
          sql<string>`COUNT(*)`.as('count'),
          sql<string>`COALESCE(SUM(invoices.total), 0)`.as('total'),
          sql<string>`COALESCE(SUM(invoices.total - invoices.amount_paid), 0)`.as('due'),
        ])
        .executeTakeFirst(),
    ]);

    // e-invoice status, in one query rather than one per row.
    const ids = rows.map((r) => r.id);
    const marks = ids.length
      ? await db
          .selectFrom('einvoices')
          .select(['invoice_id', 'status', 'irn'])
          .where('invoice_id', 'in', ids)
          .execute()
      : [];
    const markBy = new Map(marks.map((m) => [m.invoice_id, m]));

    return {
      invoices: rows.map((r) => ({
        id: asId(r.id),
        number: r.number,
        date: r.invoice_date,
        dueDate: r.due_date,
        status: r.status,
        supplyType: r.supply_type,
        supplyKind: r.supply_kind,
        customerId: asId(r.customer_id),
        customerName: r.customer_name,
        branchId: asId(r.branch_id),
        subtotalPaise: toPaiseFromSql(r.subtotal),
        totalPaise: toPaiseFromSql(r.total),
        amountPaidPaise: toPaiseFromSql(r.amount_paid),
        balancePaise: toPaiseFromSql(r.total) - toPaiseFromSql(r.amount_paid),
        einvoice: {
          status: markBy.get(r.id)?.status ?? 'not_applicable',
          irn: markBy.get(r.id)?.irn ?? null,
        },
      })),
      summary: {
        count: Number(totals?.count ?? 0),
        totalPaise: toPaiseFromSql(totals?.total ?? '0'),
        duePaise: toPaiseFromSql(totals?.due ?? '0'),
      },
    };
  },
  { permission: { module: 'sales', action: 'view' } },
);

const LineInput = z.object({
  itemId: z.string().nullish(),
  description: z.string().nullish(),
  hsnSac: z.string().nullish(),
  qty: z.number().positive('Quantity must be above zero.'),
  uqc: z.string().nullish(),
  ratePaise: z.number().int('Rates are in whole paise.').nonnegative(),
  discountPct: z.number().min(0).max(100).optional(),
  gstRatePct: z.number().min(0).max(50).optional(),
});

const CreateInput = z.object({
  branchId: z.string(),
  customerId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.'),
  lines: z.array(LineInput).min(1, 'Add at least one line.'),
  placeOfSupply: z.string().length(2).optional(),
  supplyKind: z.enum(['goods', 'service', 'both']).optional(),
  status: z.enum(['draft', 'approved']).optional(),
  number: z.string().optional(),
  orderNumber: z.string().nullish(),
  subject: z.string().nullish(),
  paymentTerms: z.string().nullish(),
  salespersonId: z.string().nullish(),
  notes: z.string().nullish(),
  terms: z.string().nullish(),
  shippingChargePaise: z.number().int().optional(),
  adjustmentPaise: z.number().int().optional(),
  adjustmentLabel: z.string().nullish(),
  tcsPaise: z.number().int().optional(),
});

export const POST = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, CreateInput);

    // The whole thing in one transaction: number allocation, the invoice, its
    // lines, the e-invoice register row and the journal entry either all happen
    // or none do.
    const created = await transaction(async (trx) =>
      createInvoice(trx, orgId, user.userId, {
        branchId: Number(input.branchId),
        customerId: Number(input.customerId),
        date: input.date,
        dueDate: input.dueDate,
        placeOfSupply: input.placeOfSupply,
        supplyKind: input.supplyKind,
        status: input.status,
        number: input.number,
        orderNumber: input.orderNumber,
        subject: input.subject,
        paymentTerms: input.paymentTerms,
        salespersonId: input.salespersonId ? Number(input.salespersonId) : null,
        notes: input.notes,
        terms: input.terms,
        shippingChargePaise: input.shippingChargePaise,
        adjustmentPaise: input.adjustmentPaise,
        adjustmentLabel: input.adjustmentLabel,
        tcsPaise: input.tcsPaise,
        lines: input.lines.map((l) => ({
          itemId: l.itemId ? Number(l.itemId) : null,
          description: l.description,
          hsnSac: l.hsnSac,
          qty: l.qty,
          uqc: l.uqc,
          ratePaise: l.ratePaise,
          discountPct: l.discountPct,
          gstRatePct: l.gstRatePct,
        })),
      }),
    );

    await logAudit({
      orgId,
      actorUserId: user.userId,
      actorName: user.name,
      action: 'create',
      targetType: 'invoice',
      targetId: created.id,
      targetLabel: created.number,
      detail: `Created invoice ${created.number}`,
      ...auditMeta(req),
    });

    return {
      id: asId(created.id),
      number: created.number,
      totalPaise: created.totalPaise,
      journalEntryId: created.journalEntryId ? asId(created.journalEntryId) : null,
    };
  },
  { permission: { module: 'sales', action: 'create' } },
);
