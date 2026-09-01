import { z } from 'zod';
import { sql } from 'kysely';
import { db, transaction } from '@/lib/server/db';
import { route, body, query, asId, badRequest } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';
import { receivePayment, makePayment } from '@/lib/server/services/payments';
import { logAudit, auditMeta } from '@/lib/server/audit';

const ListQuery = z.object({
  kind: z.enum(['received', 'made']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  contactId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET = route(
  async ({ orgId, req }) => {
    const q = query(req, ListQuery);

    let base = db
      .selectFrom('payments')
      .innerJoin('contacts', 'contacts.id', 'payments.contact_id')
      .innerJoin('bank_accounts', 'bank_accounts.id', 'payments.bank_account_id')
      .where('payments.org_id', '=', orgId);

    if (q.kind) base = base.where('payments.kind', '=', q.kind);
    if (q.from) base = base.where('payments.payment_date', '>=', q.from);
    if (q.to) base = base.where('payments.payment_date', '<=', q.to);
    if (q.contactId) base = base.where('payments.contact_id', '=', Number(q.contactId));

    const [rows, totals] = await Promise.all([
      base
        .select([
          'payments.id', 'payments.number', 'payments.kind', 'payments.payment_date',
          'payments.mode', 'payments.amount', 'payments.tds_amount', 'payments.bank_charges',
          'payments.unapplied_amount', 'payments.reference', 'payments.status',
          'payments.contact_id', 'contacts.display_name as contact_name',
          'bank_accounts.name as bank_name',
        ])
        .orderBy('payments.payment_date', 'desc')
        .orderBy('payments.id', 'desc')
        .limit(q.limit)
        .offset(q.offset)
        .execute(),
      base
        .select([
          sql<string>`COUNT(*)`.as('count'),
          sql<string>`COALESCE(SUM(payments.amount), 0)`.as('total'),
          sql<string>`COALESCE(SUM(payments.unapplied_amount), 0)`.as('unapplied'),
        ])
        .executeTakeFirst(),
    ]);

    // How many documents each receipt settled. Fetched for the visible page
    // only, and grouped rather than counted per row.
    const ids = rows.map((r) => r.id);
    const allocRows = ids.length
      ? await db
          .selectFrom('payment_allocations')
          .select(['payment_id', sql<string>`COUNT(*)`.as('n')])
          .where('payment_id', 'in', ids)
          .groupBy('payment_id')
          .execute()
      : [];
    const allocBy = new Map(allocRows.map((a) => [a.payment_id, Number(a.n)]));

    return {
      payments: rows.map((r) => ({
        id: asId(r.id),
        number: r.number,
        kind: r.kind,
        date: r.payment_date,
        mode: r.mode,
        status: r.status,
        contactId: asId(r.contact_id),
        contactName: r.contact_name,
        bankName: r.bank_name,
        reference: r.reference,
        amountPaise: toPaiseFromSql(r.amount),
        tdsPaise: toPaiseFromSql(r.tds_amount),
        bankChargesPaise: toPaiseFromSql(r.bank_charges),
        unappliedPaise: toPaiseFromSql(r.unapplied_amount),
        allocationCount: allocBy.get(r.id) ?? 0,
      })),
      summary: {
        count: Number(totals?.count ?? 0),
        totalPaise: toPaiseFromSql(totals?.total ?? '0'),
        unappliedPaise: toPaiseFromSql(totals?.unapplied ?? '0'),
      },
    };
  },
  { permission: { module: 'sales', action: 'view' } },
);

const CreateInput = z.object({
  kind: z.enum(['received', 'made']),
  branchId: z.string(),
  contactId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.'),
  mode: z.enum(['cash', 'cheque', 'neft', 'rtgs', 'imps', 'upi', 'card', 'netbanking', 'other']),
  amountPaise: z.number().int().positive('Enter an amount above zero.'),
  bankAccountId: z.string(),
  reference: z.string().nullish(),
  tdsPaise: z.number().int().nonnegative().optional(),
  bankChargesPaise: z.number().int().nonnegative().optional(),
  notes: z.string().nullish(),
  allocations: z
    .array(
      z.object({
        targetType: z.enum(['invoice', 'bill', 'credit_note', 'vendor_credit', 'retainer']),
        targetId: z.string(),
        amountPaise: z.number().int().positive(),
      }),
    )
    .optional(),
});

export const POST = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, CreateInput);

    // A receipt settles sales documents and a payment settles purchase ones.
    // Crossing them would credit a customer for paying a supplier's bill.
    const salesTargets = ['invoice', 'credit_note', 'retainer'];
    for (const a of input.allocations ?? []) {
      const isSales = salesTargets.includes(a.targetType);
      if (input.kind === 'received' && !isSales) {
        throw badRequest(`A receipt cannot be allocated against a ${a.targetType.replace('_', ' ')}.`);
      }
      if (input.kind === 'made' && isSales) {
        throw badRequest(`A payment cannot be allocated against a ${a.targetType.replace('_', ' ')}.`);
      }
    }

    const payload = {
      branchId: Number(input.branchId),
      contactId: Number(input.contactId),
      date: input.date,
      mode: input.mode,
      amountPaise: input.amountPaise,
      bankAccountId: Number(input.bankAccountId),
      reference: input.reference,
      tdsPaise: input.tdsPaise,
      bankChargesPaise: input.bankChargesPaise,
      notes: input.notes,
      allocations: (input.allocations ?? []).map((a) => ({
        targetType: a.targetType,
        targetId: Number(a.targetId),
        amountPaise: a.amountPaise,
      })),
    };

    const created = await transaction(async (trx) =>
      input.kind === 'received'
        ? receivePayment(trx, orgId, user.userId, payload)
        : makePayment(trx, orgId, user.userId, payload),
    );

    await logAudit({
      orgId,
      actorUserId: user.userId,
      actorName: user.name,
      action: 'create',
      targetType: input.kind === 'received' ? 'payment_received' : 'payment_made',
      targetId: created.id,
      targetLabel: created.number,
      detail: `${input.kind === 'received' ? 'Received' : 'Paid'} ${(input.amountPaise / 100).toFixed(2)}`,
      ...auditMeta(req),
    });

    return {
      id: asId(created.id),
      number: created.number,
      unappliedPaise: created.unappliedPaise,
      journalEntryId: asId(created.journalEntryId),
    };
  },
  { permission: { module: 'sales', action: 'create' } },
);
