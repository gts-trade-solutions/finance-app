import { z } from 'zod';
import { db, transaction } from '@/lib/server/db';
import { route, body, query, asId, badRequest, conflict } from '@/lib/server/http';
import { toPaiseFromSql, toSqlFromPaise } from '@/lib/server/money-sql';
import { postEntry } from '@/lib/server/ledger/posting';
import { logAudit, auditMeta } from '@/lib/server/audit';

// ─────────────────────────────────────────────────────────────────────────────
// Recurring journals: entries that repeat unchanged month after month —
// depreciation, prepaid rent amortisation, accrued salaries.
//
// A profile is a template, not a posting. Nothing reaches the ledger until it
// is run, and running it goes through the same posting engine as everything
// else, so a locked period refuses it exactly as it would refuse a hand-typed
// entry. That is deliberate: an automation that could quietly post into a
// closed month would be worse than no automation at all.
// ─────────────────────────────────────────────────────────────────────────────

const FREQUENCIES = ['monthly', 'quarterly', 'yearly'] as const;

/** Move a date forward by one period of the given frequency. */
function advance(date: string, frequency: (typeof FREQUENCIES)[number]): string {
  const d = new Date(date);
  const day = d.getDate();
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  // Rolling 31 Jan forward must not land in March. Clamp to the month's end.
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

export const GET = route(
  async ({ orgId }) => {
    const rows = await db
      .selectFrom('recurring_journals as r')
      .innerJoin('accounts as dr', 'dr.id', 'r.debit_account_id')
      .innerJoin('accounts as cr', 'cr.id', 'r.credit_account_id')
      .select([
        'r.id', 'r.name', 'r.frequency', 'r.next_run', 'r.end_date', 'r.amount',
        'r.memo', 'r.is_active', 'r.last_posted_at', 'r.branch_id',
        'r.debit_account_id', 'r.credit_account_id',
        'dr.code as debit_code', 'dr.name as debit_name',
        'cr.code as credit_code', 'cr.name as credit_name',
      ])
      .where('r.org_id', '=', orgId)
      .orderBy('r.next_run')
      .execute();

    const today = new Date().toISOString().slice(0, 10);

    return {
      profiles: rows.map((r) => ({
        id: asId(r.id),
        name: r.name,
        frequency: r.frequency,
        nextRun: String(r.next_run).slice(0, 10),
        endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
        debitAccountId: asId(r.debit_account_id),
        debitCode: r.debit_code,
        debitName: r.debit_name,
        creditAccountId: asId(r.credit_account_id),
        creditCode: r.credit_code,
        creditName: r.credit_name,
        amountPaise: toPaiseFromSql(r.amount),
        memo: r.memo,
        isActive: !!r.is_active,
        lastPostedAt: r.last_posted_at ? String(r.last_posted_at).slice(0, 10) : null,
        /** Overdue profiles are the ones somebody needs to look at today. */
        isDue: !!r.is_active && String(r.next_run).slice(0, 10) <= today,
      })),
    };
  },
  { permission: { module: 'accountant', action: 'view' } },
);

const ProfileInput = z.object({
  name: z.string().trim().min(1, 'Give the profile a name.').max(200),
  frequency: z.enum(FREQUENCIES),
  nextRun: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give a yyyy-mm-dd date.'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  debitAccountId: z.union([z.string(), z.number()]),
  creditAccountId: z.union([z.string(), z.number()]),
  amountPaise: z.number().int().positive('An entry needs an amount above zero.'),
  memo: z.string().trim().max(500).nullish(),
});

export const POST = route(
  async ({ orgId, user, branchId, req }) => {
    const input = await body(req, ProfileInput);
    const dr = Number(input.debitAccountId);
    const cr = Number(input.creditAccountId);

    if (dr === cr) {
      throw badRequest('The debit and credit sides must be different accounts, or nothing moves.');
    }

    const found = await db
      .selectFrom('accounts').select(['id'])
      .where('org_id', '=', orgId).where('id', 'in', [dr, cr]).execute();
    if (found.length !== 2) throw badRequest('One of those accounts does not exist.');

    const inserted = await db
      .insertInto('recurring_journals')
      .values({
        org_id: orgId,
        branch_id: branchId,
        name: input.name,
        frequency: input.frequency,
        next_run: input.nextRun,
        end_date: input.endDate ?? null,
        debit_account_id: dr,
        credit_account_id: cr,
        amount: toSqlFromPaise(input.amountPaise),
        memo: input.memo ?? null,
        is_active: 1,
      })
      .executeTakeFirstOrThrow();

    const id = Number(inserted.insertId);
    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'create',
      targetType: 'recurring_journal', targetId: id, targetLabel: input.name,
      detail: `${input.frequency} profile for ${(input.amountPaise / 100).toFixed(2)}, next ${input.nextRun}`,
      ...auditMeta(req),
    });

    return { id: asId(id), name: input.name };
  },
  { permission: { module: 'accountant', action: 'create' } },
);

const ActionInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('run'),
    id: z.union([z.string(), z.number()]),
    /** Post on this date instead of the profile's scheduled one. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    action: z.literal('toggle'),
    id: z.union([z.string(), z.number()]),
    isActive: z.boolean(),
  }),
]);

/**
 * Run a profile, or pause it.
 *
 * Running posts one entry and rolls the schedule forward. It does not catch up
 * on missed periods: silently posting six months of depreciation because
 * nobody opened the screen since March is not a favour to anyone.
 */
export const PATCH = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, ActionInput);
    const id = Number(input.id);

    const profile = await db
      .selectFrom('recurring_journals')
      .selectAll()
      .where('id', '=', id)
      .where('org_id', '=', orgId)
      .executeTakeFirst();
    if (!profile) throw badRequest('That profile does not exist.');

    if (input.action === 'toggle') {
      await db
        .updateTable('recurring_journals')
        .set({ is_active: input.isActive ? 1 : 0 })
        .where('id', '=', id)
        .execute();
      await logAudit({
        orgId, actorUserId: user.userId, actorName: user.name, action: 'update',
        targetType: 'recurring_journal', targetId: id, targetLabel: profile.name,
        detail: input.isActive ? 'Resumed' : 'Paused', ...auditMeta(req),
      });
      return { id: asId(id), isActive: input.isActive };
    }

    if (!profile.is_active) throw conflict(`${profile.name} is paused. Resume it before running it.`);

    const runDate = input.date ?? String(profile.next_run).slice(0, 10);
    if (profile.end_date && runDate > String(profile.end_date).slice(0, 10)) {
      throw conflict(`${profile.name} ended on ${String(profile.end_date).slice(0, 10)}.`);
    }

    const amount = toPaiseFromSql(profile.amount);
    const entry = await transaction(async (trx) =>
      postEntry(trx, {
        orgId,
        branchId: profile.branch_id,
        date: runDate,
        memo: profile.memo || profile.name,
        sourceType: 'recurring',
        sourceId: id,
        userId: user.userId,
        module: 'accountant',
        lines: [
          { accountId: profile.debit_account_id, debit: amount },
          { accountId: profile.credit_account_id, credit: amount },
        ],
      }),
    );

    await db
      .updateTable('recurring_journals')
      .set({
        last_posted_at: runDate,
        next_run: advance(runDate, profile.frequency as (typeof FREQUENCIES)[number]),
      })
      .where('id', '=', id)
      .execute();

    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'create',
      targetType: 'recurring_journal', targetId: id, targetLabel: profile.name,
      detail: `Posted JE #${entry.entryNo} for ${(amount / 100).toFixed(2)} on ${runDate}`,
      ...auditMeta(req),
    });

    return { id: asId(id), entryId: asId(entry.id), entryNo: entry.entryNo, postedOn: runDate };
  },
  { permission: { module: 'accountant', action: 'create' } },
);

/** Delete a profile. The entries it already posted stay — they are real. */
export const DELETE = route(
  async ({ orgId, user, req }) => {
    const { id } = query(req, z.object({ id: z.string() }));
    const numeric = Number(id);

    const profile = await db
      .selectFrom('recurring_journals').select(['id', 'name'])
      .where('id', '=', numeric).where('org_id', '=', orgId).executeTakeFirst();
    if (!profile) throw badRequest('That profile does not exist.');

    await db.deleteFrom('recurring_journals').where('id', '=', numeric).where('org_id', '=', orgId).execute();
    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'void',
      targetType: 'recurring_journal', targetId: numeric, targetLabel: profile.name,
      detail: 'Profile deleted. Entries it already posted are unaffected.', ...auditMeta(req),
    });

    return { id: asId(numeric) };
  },
  { permission: { module: 'accountant', action: 'edit' } },
);
