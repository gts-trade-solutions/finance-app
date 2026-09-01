import { z } from 'zod';
import { sql } from 'kysely';
import { db, transaction } from '@/lib/server/db';
import { route, body, query, asId, badRequest, conflict } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';
import { postEntry } from '@/lib/server/ledger/posting';
import { CODE, accountIds, requireAccount } from '@/lib/server/ledger/chart-of-accounts';
import { logAudit, auditMeta } from '@/lib/server/audit';

// ─────────────────────────────────────────────────────────────────────────────
// Stock.
//
// Quantity on hand is derived, never stored: opening, plus what the bills
// brought in, less what the invoices sent out, plus or minus adjustments. The
// documents are the record. A stored running quantity could only be a second
// copy to fall out of step with them, and a stock figure that disagrees with
// the purchase and sales history is worse than no figure at all.
//
// Valuation is weighted average cost. FIFO would be more precise and needs a
// per-batch layer table to be honest about; average cost from the bills is
// what can actually be substantiated from what is here.
// ─────────────────────────────────────────────────────────────────────────────

const Q = z.object({
  view: z.enum(['stock', 'adjustments', 'warehouses']).default('stock'),
  itemId: z.string().optional(),
});

export const GET = route(
  async ({ orgId, req }) => {
    const q = query(req, Q);

    if (q.view === 'warehouses') {
      const rows = await db
        .selectFrom('warehouses as w')
        .leftJoin('branches as b', 'b.id', 'w.branch_id')
        .select([
          'w.id', 'w.name', 'w.code', 'w.address', 'w.is_primary', 'w.is_active',
          'w.branch_id', 'b.name as branch_name',
        ])
        .where('w.org_id', '=', orgId)
        .orderBy('w.is_primary', 'desc')
        .orderBy('w.name')
        .execute();

      return {
        view: q.view,
        warehouses: rows.map((w) => ({
          id: asId(w.id),
          name: w.name,
          code: w.code,
          address: w.address,
          branchId: w.branch_id === null ? null : asId(w.branch_id),
          branchName: w.branch_name,
          isPrimary: !!w.is_primary,
          isActive: !!w.is_active,
        })),
      };
    }

    if (q.view === 'adjustments') {
      const rows = await db
        .selectFrom('stock_adjustments as a')
        .innerJoin('items as i', 'i.id', 'a.item_id')
        .leftJoin('warehouses as w', 'w.id', 'a.warehouse_id')
        .leftJoin('users as u', 'u.id', 'a.created_by_user_id')
        .select([
          'a.id', 'a.adjust_date', 'a.qty_delta', 'a.reason', 'a.notes',
          'a.journal_entry_id', 'a.item_id',
          'i.name as item_name', 'i.sku', 'i.uqc', 'i.purchase_price',
          'w.name as warehouse_name', 'u.name as user_name',
        ])
        .where('a.org_id', '=', orgId)
        .$if(!!q.itemId, (qb) => qb.where('a.item_id', '=', Number(q.itemId)))
        .orderBy('a.adjust_date', 'desc')
        .orderBy('a.id', 'desc')
        .limit(300)
        .execute();

      return {
        view: q.view,
        adjustments: rows.map((a) => ({
          id: asId(a.id),
          date: String(a.adjust_date).slice(0, 10),
          itemId: asId(a.item_id),
          itemName: a.item_name,
          sku: a.sku,
          uqc: a.uqc,
          qtyDelta: Number(a.qty_delta),
          reason: a.reason,
          notes: a.notes,
          warehouseName: a.warehouse_name,
          userName: a.user_name,
          valuePaise: Math.round(Number(a.qty_delta) * toPaiseFromSql(a.purchase_price)),
          journalEntryId: a.journal_entry_id === null ? null : asId(a.journal_entry_id),
        })),
      };
    }

    // Stock on hand, item by item, from the documents.
    const { rows } = await sql<{
      id: number; name: string; sku: string | null; uqc: string;
      opening: string | null; reorder: string | null; purchase_price: string;
      bought: string; sold: string; adjusted: string;
      bought_value: string;
    }>`
      SELECT it.id, it.name, it.sku, it.uqc,
             it.opening_stock_qty AS opening,
             it.reorder_level AS reorder,
             it.purchase_price,
             COALESCE((SELECT SUM(bl.qty) FROM bill_lines bl
                         JOIN bills b ON b.id = bl.bill_id
                        WHERE bl.item_id = it.id AND b.org_id = it.org_id
                          AND b.status NOT IN ('draft','void')), 0) AS bought,
             COALESCE((SELECT SUM(il.qty) FROM invoice_lines il
                         JOIN invoices i ON i.id = il.invoice_id
                        WHERE il.item_id = it.id AND i.org_id = it.org_id
                          AND i.status NOT IN ('draft','void')), 0) AS sold,
             COALESCE((SELECT SUM(a.qty_delta) FROM stock_adjustments a
                        WHERE a.item_id = it.id AND a.org_id = it.org_id), 0) AS adjusted,
             COALESCE((SELECT SUM(bl.qty * bl.rate) FROM bill_lines bl
                         JOIN bills b ON b.id = bl.bill_id
                        WHERE bl.item_id = it.id AND b.org_id = it.org_id
                          AND b.status NOT IN ('draft','void')), 0) AS bought_value
        FROM items it
       WHERE it.org_id = ${orgId} AND it.is_archived = 0 AND it.kind = 'goods'
       ORDER BY it.name
    `.execute(db);

    const items = rows.map((r) => {
      const opening = Number(r.opening ?? 0);
      const bought = Number(r.bought);
      const sold = Number(r.sold);
      const adjusted = Number(r.adjusted);
      const qty = opening + bought - sold + adjusted;

      // Weighted average of what was actually paid; the catalogue price is the
      // fallback for an item nothing has been bought of yet.
      const boughtValue = Math.round(Number(r.bought_value) * 100);
      const unitCost = bought > 0 ? Math.round(boughtValue / bought) : toPaiseFromSql(r.purchase_price);

      return {
        itemId: asId(r.id),
        name: r.name,
        sku: r.sku,
        uqc: r.uqc,
        openingQty: opening,
        boughtQty: bought,
        soldQty: sold,
        adjustedQty: adjusted,
        qty,
        reorderLevel: r.reorder === null ? 0 : Number(r.reorder),
        unitCostPaise: unitCost,
        // Negative stock is not netted away. It means the documents disagree
        // with reality, and hiding it would hide the problem.
        valuePaise: Math.round(qty * unitCost),
      };
    });

    return {
      view: 'stock' as const,
      items,
      summary: {
        totalValuePaise: items.reduce((t, i) => t + i.valuePaise, 0),
        lowStock: items.filter((i) => i.qty > 0 && i.qty <= i.reorderLevel).length,
        outOfStock: items.filter((i) => i.qty <= 0).length,
        negative: items.filter((i) => i.qty < 0).length,
        tracked: items.length,
      },
    };
  },
  { permission: { module: 'inventory', action: 'view' } },
);

const AdjustInput = z.object({
  itemId: z.union([z.string(), z.number()]),
  warehouseId: z.union([z.string(), z.number()]).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.'),
  qtyDelta: z.number().refine((v) => v !== 0, 'An adjustment of zero changes nothing.'),
  reason: z.enum(['damage', 'theft', 'stocktake', 'expiry', 'sample', 'opening', 'other']),
  notes: z.string().trim().max(500).nullish(),
});

/**
 * Adjust stock, and post the value change.
 *
 * Writing stock off is a real loss, so it posts:
 *
 *   Dr Written-off / COGS   the value that has gone
 *     Cr Inventory          the asset that no longer exists
 *
 * A correction upward reverses that. This is the part most stock screens skip,
 * and skipping it means the balance sheet carries inventory that is not there.
 */
export const POST = route(
  async ({ orgId, user, branchId, req }) => {
    const input = await body(req, AdjustInput);
    const itemId = Number(input.itemId);

    const item = await db
      .selectFrom('items')
      .select(['id', 'name', 'kind', 'purchase_price', 'is_archived'])
      .where('id', '=', itemId).where('org_id', '=', orgId).executeTakeFirst();
    if (!item) throw badRequest('That item does not exist.');
    if (item.kind !== 'goods') throw badRequest('Only goods carry stock. A service has none to adjust.');
    if (item.is_archived) throw conflict(`${item.name} is archived.`);

    const unitCost = toPaiseFromSql(item.purchase_price);
    const valuePaise = Math.round(Math.abs(input.qtyDelta) * unitCost);

    const result = await transaction(async (trx) => {
      let journalEntryId: number | null = null;

      // Only post when there is value to move. An item carried at nil cost
      // moves no money, and inventing an entry for it would be noise.
      if (valuePaise > 0) {
        const acc = await accountIds(trx, orgId);
        const lossAccount = requireAccount(acc, CODE.WRITE_OFF);
        const inventory = requireAccount(acc, CODE.INVENTORY);

        const entry = await postEntry(trx, {
          orgId,
          branchId,
          date: input.date,
          memo: `Stock adjustment — ${item.name} (${input.reason})`,
          sourceType: 'stock_adjustment',
          userId: user.userId,
          module: 'accountant',
          lines:
            input.qtyDelta < 0
              ? [
                  { accountId: lossAccount, debit: valuePaise },
                  { accountId: inventory, credit: valuePaise },
                ]
              : [
                  { accountId: inventory, debit: valuePaise },
                  { accountId: lossAccount, credit: valuePaise },
                ],
        });
        journalEntryId = entry.id;
      }

      const inserted = await trx
        .insertInto('stock_adjustments')
        .values({
          org_id: orgId,
          warehouse_id: input.warehouseId ? Number(input.warehouseId) : null,
          item_id: itemId,
          adjust_date: input.date,
          qty_delta: String(input.qtyDelta),
          reason: input.reason,
          notes: input.notes ?? null,
          journal_entry_id: journalEntryId,
          created_by_user_id: user.userId,
        })
        .executeTakeFirstOrThrow();

      return { id: Number(inserted.insertId), journalEntryId };
    });

    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'create',
      targetType: 'stock_adjustment', targetId: result.id, targetLabel: item.name,
      detail: `${input.qtyDelta > 0 ? '+' : ''}${input.qtyDelta} ${item.name} (${input.reason}), ` +
        `value ${(valuePaise / 100).toFixed(2)}`,
      ...auditMeta(req),
    });

    return {
      id: asId(result.id),
      valuePaise,
      journalEntryId: result.journalEntryId === null ? null : asId(result.journalEntryId),
    };
  },
  { permission: { module: 'inventory', action: 'edit' } },
);

const WarehouseInput = z.object({
  name: z.string().trim().min(1, 'A warehouse needs a name.').max(150),
  code: z.string().trim().max(20).nullish(),
  address: z.string().trim().max(500).nullish(),
  branchId: z.union([z.string(), z.number()]).nullish(),
});

export const PUT = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, WarehouseInput);

    const existing = await db
      .selectFrom('warehouses').select('id')
      .where('org_id', '=', orgId).executeTakeFirst();

    const inserted = await db
      .insertInto('warehouses')
      .values({
        org_id: orgId,
        branch_id: input.branchId ? Number(input.branchId) : null,
        name: input.name,
        code: input.code ?? null,
        address: input.address ?? null,
        // The first one is the default, so stock has somewhere to live.
        is_primary: existing ? 0 : 1,
        is_active: 1,
      })
      .executeTakeFirstOrThrow();

    const id = Number(inserted.insertId);
    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'create',
      targetType: 'warehouse', targetId: id, targetLabel: input.name,
      detail: `Added warehouse ${input.name}`, ...auditMeta(req),
    });

    return { id: asId(id), name: input.name };
  },
  { permission: { module: 'inventory', action: 'create' } },
);
