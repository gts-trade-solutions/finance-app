import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '@/lib/server/db';
import { route, body, query, asId, badRequest, conflict } from '@/lib/server/http';
import { toPaiseFromSql, toSqlFromPaise } from '@/lib/server/money-sql';
import { logAudit, auditMeta } from '@/lib/server/audit';
import { CODE, accountIds } from '@/lib/server/ledger/chart-of-accounts';

const ListQuery = z.object({
  kind: z.enum(['goods', 'service', 'all']).optional(),
  search: z.string().optional(),
  archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * The item catalogue, with how much each item has actually sold.
 *
 * The sales figures come from the invoice lines rather than a stored counter.
 * A counter is one more thing that can drift; the lines are the record.
 */
export const GET = route(
  async ({ orgId, req }) => {
    const q = query(req, ListQuery);

    let base = db.selectFrom('items').where('org_id', '=', orgId);
    if (!q.archived) base = base.where('is_archived', '=', 0);
    if (q.kind && q.kind !== 'all') base = base.where('kind', '=', q.kind);
    if (q.search) {
      const term = `%${q.search}%`;
      base = base.where((eb) =>
        eb.or([eb('name', 'like', term), eb('sku', 'like', term), eb('hsn_sac', 'like', term)]),
      );
    }

    const rows = await base
      .select([
        'id', 'kind', 'name', 'sku', 'hsn_sac', 'uqc', 'sale_price', 'purchase_price',
        'gst_rate_pct', 'tax_pref', 'description', 'track_inventory', 'reorder_level',
        'is_archived',
      ])
      .orderBy('name')
      .limit(q.limit)
      .offset(q.offset)
      .execute();

    const ids = rows.map((r) => r.id);
    const sold = ids.length
      ? await db
          .selectFrom('invoice_lines')
          .innerJoin('invoices', 'invoices.id', 'invoice_lines.invoice_id')
          .select([
            'invoice_lines.item_id as id',
            sql<string>`COALESCE(SUM(invoice_lines.qty), 0)`.as('qty'),
            sql<string>`COALESCE(SUM(invoice_lines.taxable), 0)`.as('value'),
          ])
          .where('invoices.org_id', '=', orgId)
          .where('invoice_lines.item_id', 'in', ids)
          .where('invoices.status', 'not in', ['draft', 'void'])
          .groupBy('invoice_lines.item_id')
          .execute()
      : [];
    const soldBy = new Map(sold.map((s) => [s.id, s]));

    return {
      items: rows.map((i) => ({
        id: asId(i.id),
        kind: i.kind,
        name: i.name,
        sku: i.sku,
        hsnSac: i.hsn_sac,
        uqc: i.uqc,
        salePricePaise: toPaiseFromSql(i.sale_price),
        purchasePricePaise: toPaiseFromSql(i.purchase_price),
        gstRatePct: Number(i.gst_rate_pct),
        taxPref: i.tax_pref,
        description: i.description,
        trackInventory: !!i.track_inventory,
        reorderLevel: i.reorder_level === null ? null : Number(i.reorder_level),
        isArchived: !!i.is_archived,
        qtySold: Number(soldBy.get(i.id)?.qty ?? 0),
        soldValuePaise: toPaiseFromSql(soldBy.get(i.id)?.value ?? '0'),
        // Margin per unit, which is the number that decides whether an item is
        // worth stocking. Shown only when both prices are known.
        marginPaise: toPaiseFromSql(i.sale_price) - toPaiseFromSql(i.purchase_price),
      })),
    };
  },
  { permission: { module: 'sales', action: 'view' } },
);

const ItemInput = z.object({
  kind: z.enum(['goods', 'service']),
  name: z.string().trim().min(1, 'An item needs a name.').max(200),
  sku: z.string().trim().max(60).nullish(),
  hsnSac: z.string().trim().max(8).nullish(),
  uqc: z.string().trim().max(10).default('NOS'),
  salePricePaise: z.number().int().min(0),
  purchasePricePaise: z.number().int().min(0).default(0),
  gstRatePct: z.number().min(0).max(50),
  taxPref: z.enum(['taxable', 'exempt', 'nil', 'non_gst']).default('taxable'),
  description: z.string().trim().max(1000).nullish(),
  trackInventory: z.boolean().optional(),
  reorderLevel: z.number().min(0).nullish(),
});

const UpdateInput = ItemInput.partial().extend({
  id: z.string(),
  isArchived: z.boolean().optional(),
});

/**
 * An HSN/SAC on an item has to be one the organisation has approved, for the
 * same reason it does on an invoice line: GSTR-1 Table 12 is validated against
 * the official master and one bad code bounces the whole return.
 *
 * The kind also has to match. SAC codes begin 99 and describe services; putting
 * one on a goods item files the supply in the wrong table.
 */
async function checkHsn(orgId: number, hsn: string | null | undefined, kind: 'goods' | 'service' | undefined) {
  if (!hsn) return;
  const row = await db
    .selectFrom('hsn_codes')
    .select(['code', 'kind', 'is_active'])
    .where('org_id', '=', orgId)
    .where('code', '=', hsn)
    .executeTakeFirst();
  if (!row || !row.is_active) {
    throw badRequest(
      `HSN/SAC ${hsn} is not on the approved list. An admin can add it under Settings → HSN & SAC Codes.`,
    );
  }
  if (kind && ((kind === 'service') !== (row.kind === 'sac'))) {
    throw badRequest(
      `${hsn} is ${row.kind === 'sac' ? 'a SAC, which describes a service' : 'an HSN, which describes goods'} — ` +
        `but this item is ${kind}.`,
    );
  }
}

export const POST = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, ItemInput);
    await checkHsn(orgId, input.hsnSac, input.kind);

    // Which income and expense heads this item posts to. The posting engine
    // falls back to Sales and Purchases when these are null, so an item without
    // them still works — but then the columns say nothing, and an item created
    // through the API would differ from one the seed made. Goods and services
    // are separate income heads because the P&L is more useful when they are.
    const acc = await accountIds(db, orgId);
    const saleAccountId =
      acc[input.kind === 'service' ? CODE.SERVICE_INCOME : CODE.SALES] ?? null;
    const purchaseAccountId = acc[CODE.PURCHASES] ?? null;

    const inserted = await db
      .insertInto('items')
      .values({
        org_id: orgId,
        kind: input.kind,
        sale_account_id: saleAccountId,
        purchase_account_id: purchaseAccountId,
        name: input.name,
        sku: input.sku ?? null,
        hsn_sac: input.hsnSac ?? null,
        uqc: input.uqc,
        sale_price: toSqlFromPaise(input.salePricePaise),
        purchase_price: toSqlFromPaise(input.purchasePricePaise),
        gst_rate_pct: input.gstRatePct,
        tax_pref: input.taxPref,
        description: input.description ?? null,
        track_inventory: input.trackInventory ? 1 : 0,
        reorder_level: input.reorderLevel ?? null,
      })
      .executeTakeFirstOrThrow();

    const id = Number(inserted.insertId);
    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'create',
      targetType: 'item', targetId: id, targetLabel: input.name,
      detail: `Added ${input.kind} "${input.name}"`, ...auditMeta(req),
    });

    return { id: asId(id), name: input.name };
  },
  { permission: { module: 'sales', action: 'create' } },
);

export const PATCH = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, UpdateInput);
    const id = Number(input.id);

    const existing = await db
      .selectFrom('items')
      .select(['id', 'name', 'kind', 'hsn_sac'])
      .where('id', '=', id)
      .where('org_id', '=', orgId)
      .executeTakeFirst();
    if (!existing) throw badRequest('That item does not exist.');

    await checkHsn(
      orgId,
      input.hsnSac === undefined ? existing.hsn_sac : input.hsnSac,
      (input.kind ?? existing.kind) as 'goods' | 'service',
    );

    if (input.isArchived) {
      // Archiving an item used on a document that is still open would leave
      // that document referring to something the pickers can no longer show.
      const open = await db
        .selectFrom('invoice_lines')
        .innerJoin('invoices', 'invoices.id', 'invoice_lines.invoice_id')
        .select(sql<string>`COUNT(*)`.as('n'))
        .where('invoices.org_id', '=', orgId)
        .where('invoice_lines.item_id', '=', id)
        .where('invoices.status', '=', 'draft')
        .executeTakeFirst();
      if (Number(open?.n ?? 0) > 0) {
        throw conflict(`"${existing.name}" is on a draft invoice. Remove it there first, or issue the draft.`);
      }
    }

    const patch: Record<string, unknown> = {};
    const set = (col: string, v: unknown) => { if (v !== undefined) patch[col] = v; };
    set('kind', input.kind);
    set('name', input.name);
    set('sku', input.sku);
    set('hsn_sac', input.hsnSac);
    set('uqc', input.uqc);
    set('sale_price', input.salePricePaise === undefined ? undefined : toSqlFromPaise(input.salePricePaise));
    set('purchase_price', input.purchasePricePaise === undefined ? undefined : toSqlFromPaise(input.purchasePricePaise));
    set('gst_rate_pct', input.gstRatePct);
    set('tax_pref', input.taxPref);
    set('description', input.description);
    set('track_inventory', input.trackInventory === undefined ? undefined : input.trackInventory ? 1 : 0);
    set('reorder_level', input.reorderLevel);
    set('is_archived', input.isArchived === undefined ? undefined : input.isArchived ? 1 : 0);

    if (Object.keys(patch).length) {
      await db.updateTable('items').set(patch).where('id', '=', id).where('org_id', '=', orgId).execute();
    }

    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'update',
      targetType: 'item', targetId: id, targetLabel: existing.name,
      detail: `${input.isArchived ? 'Archived' : 'Updated'} "${existing.name}"`, ...auditMeta(req),
    });

    return { id: asId(id) };
  },
  { permission: { module: 'sales', action: 'edit' } },
);
