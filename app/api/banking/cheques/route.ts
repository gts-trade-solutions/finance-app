import { z } from 'zod';
import { db } from '@/lib/server/db';
import { route, body, asId, badRequest, conflict } from '@/lib/server/http';
import { toPaiseFromSql, toSqlFromPaise } from '@/lib/server/money-sql';
import { logAudit, auditMeta } from '@/lib/server/audit';

// ─────────────────────────────────────────────────────────────────────────────
// The cheque register.
//
// This is a record of paper in a drawer, not a ledger. A post-dated cheque
// changes no balance until it clears: the money is neither yours nor theirs
// while it sits waiting to mature, and booking it early would show cash you
// cannot spend. The payment that actually moves the money is recorded
// separately, when the cheque clears.
//
// What the register is for is the question the ledger cannot answer — what is
// due to land next week, and what has bounced.
// ─────────────────────────────────────────────────────────────────────────────

export const GET = route(
  async ({ orgId }) => {
    const rows = await db
      .selectFrom('cheques as q')
      .innerJoin('contacts as c', 'c.id', 'q.contact_id')
      .select([
        'q.id', 'q.kind', 'q.cheque_no', 'q.bank_name', 'q.amount', 'q.is_pdc',
        'q.maturity_date', 'q.status', 'q.notes', 'q.payment_id',
        'q.contact_id', 'c.display_name as contact_name',
      ])
      .where('q.org_id', '=', orgId)
      .orderBy('q.maturity_date')
      .execute();

    const cheques = rows.map((r) => ({
      id: asId(r.id),
      kind: r.kind,
      chequeNo: r.cheque_no,
      bankName: r.bank_name,
      contactId: asId(r.contact_id),
      contactName: r.contact_name,
      amountPaise: toPaiseFromSql(r.amount),
      isPdc: !!r.is_pdc,
      maturityDate: String(r.maturity_date).slice(0, 10),
      status: r.status,
      notes: r.notes,
      paymentId: r.payment_id === null ? null : asId(r.payment_id),
    }));

    const pending = (kind: string) =>
      cheques.filter((c) => c.kind === kind && c.isPdc && c.status === 'in_hand');
    const bounced = cheques.filter((c) => c.status === 'bounced');

    return {
      cheques,
      summary: {
        pdcInPaise: pending('received').reduce((t, c) => t + c.amountPaise, 0),
        pdcInCount: pending('received').length,
        pdcOutPaise: pending('issued').reduce((t, c) => t + c.amountPaise, 0),
        pdcOutCount: pending('issued').length,
        bouncedPaise: bounced.reduce((t, c) => t + c.amountPaise, 0),
        bouncedCount: bounced.length,
      },
    };
  },
  { permission: { module: 'banking', action: 'view' } },
);

const CreateInput = z.object({
  kind: z.enum(['issued', 'received']),
  contactId: z.union([z.string(), z.number()]),
  chequeNo: z.string().trim().min(1, 'A cheque number is required.').max(20),
  bankName: z.string().trim().max(120).nullish(),
  amountPaise: z.number().int().positive('Enter an amount above zero.'),
  maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.'),
  notes: z.string().trim().max(500).nullish(),
});

export const POST = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, CreateInput);
    const contactId = Number(input.contactId);

    const contact = await db
      .selectFrom('contacts').select(['id', 'display_name'])
      .where('id', '=', contactId).where('org_id', '=', orgId).executeTakeFirst();
    if (!contact) throw badRequest('That contact does not exist.');

    // A cheque dated in the future is post-dated, whatever anybody calls it.
    // The flag is derived rather than asked for, because a mis-ticked box would
    // put a live cheque in the "waiting to mature" bucket.
    const isPdc = input.maturityDate > new Date().toISOString().slice(0, 10);

    const inserted = await db
      .insertInto('cheques')
      .values({
        org_id: orgId,
        kind: input.kind,
        contact_id: contactId,
        cheque_no: input.chequeNo,
        bank_name: input.bankName ?? null,
        amount: toSqlFromPaise(input.amountPaise),
        is_pdc: isPdc ? 1 : 0,
        maturity_date: input.maturityDate,
        status: 'in_hand',
        notes: input.notes ?? null,
      })
      .executeTakeFirstOrThrow();

    const id = Number(inserted.insertId);
    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'create',
      targetType: 'cheque', targetId: id, targetLabel: input.chequeNo,
      detail: `${input.kind} cheque ${input.chequeNo} for ${(input.amountPaise / 100).toFixed(2)}, matures ${input.maturityDate}`,
      ...auditMeta(req),
    });

    return { id: asId(id), chequeNo: input.chequeNo, isPdc };
  },
  { permission: { module: 'banking', action: 'create' } },
);

const StatusInput = z.object({
  id: z.union([z.string(), z.number()]),
  status: z.enum(['in_hand', 'deposited', 'cleared', 'bounced', 'cancelled']),
});

/**
 * Move a cheque along.
 *
 * Marking one cleared does not post anything by itself. The money arriving is
 * a payment, and a payment is recorded on the payments screen against the
 * invoice or bill it settles — otherwise the receipt would exist twice.
 */
export const PATCH = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, StatusInput);
    const id = Number(input.id);

    const cheque = await db
      .selectFrom('cheques').select(['id', 'cheque_no', 'status', 'kind'])
      .where('id', '=', id).where('org_id', '=', orgId).executeTakeFirst();
    if (!cheque) throw badRequest('That cheque does not exist.');
    if (cheque.status === 'cleared' && input.status !== 'bounced') {
      throw conflict(
        `Cheque ${cheque.cheque_no} has already cleared. Only a return can change it after that.`,
      );
    }

    await db
      .updateTable('cheques')
      .set({ status: input.status, is_pdc: input.status === 'in_hand' ? undefined : 0 })
      .where('id', '=', id)
      .execute();

    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name,
      action: input.status === 'bounced' ? 'void' : 'update',
      targetType: 'cheque', targetId: id, targetLabel: cheque.cheque_no,
      detail: `Marked ${input.status.replace('_', ' ')}`, ...auditMeta(req),
    });

    return { id: asId(id), status: input.status };
  },
  { permission: { module: 'banking', action: 'edit' } },
);
