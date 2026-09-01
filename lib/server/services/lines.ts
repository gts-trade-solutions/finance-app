import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// Costing a document's lines.
//
// An estimate, a sales order, an invoice and a credit note all price their
// lines identically: resolve the item, check the HSN, apply the discount, work
// out the tax from the supply type. Only what happens afterwards differs — an
// invoice posts to the ledger, an estimate does not.
//
// So the arithmetic lives here once. Two copies would eventually disagree, and
// a quote that does not match the invoice raised from it is the kind of bug a
// customer finds before you do.
// ─────────────────────────────────────────────────────────────────────────────

import type { Trx } from '../db';
import type { DocTaxBreakup, Paise, SupplyKind, SupplyType } from '../../types';
import { computeLineTax, sumTax } from '../../tax/gst';
import { toPaiseFromSql } from '../money-sql';
import { badRequest } from '../http';

export interface DocumentLineInput {
  itemId?: number | null;
  description?: string | null;
  hsnSac?: string | null;
  qty: number;
  uqc?: string | null;
  /** Omit to use the item's catalogue price. Required when there is no item. */
  ratePaise?: Paise;
  discountPct?: number;
  gstRatePct?: number;
}

export interface CostedLine {
  itemId: number | null;
  description: string | null;
  hsnSac: string | null;
  qty: number;
  uqc: string;
  ratePaise: Paise;
  discountPct: number;
  gstRatePct: number;
  taxable: Paise;
  tax: DocTaxBreakup;
  total: Paise;
  /** 'goods' or 'service', from the item or the code — 99xx is always a service. */
  kind: 'goods' | 'service';
}

export interface CostedDocument {
  lines: CostedLine[];
  tax: DocTaxBreakup;
  supplyKind: SupplyKind;
}

/**
 * Price a document's lines against the catalogue, the approved HSN list and the
 * supply type.
 *
 * `priceField` decides which side of the catalogue an unpriced line falls back
 * to: what we sell it for, or what we pay for it.
 */
export async function costLines(
  trx: Trx,
  orgId: number,
  supplyType: SupplyType,
  lines: DocumentLineInput[],
  priceField: 'sale_price' | 'purchase_price' = 'sale_price',
): Promise<CostedDocument> {
  if (!lines.length) throw badRequest('A document needs at least one line.');

  // Resolve every item in one query rather than one per line.
  const itemIds = lines.map((l) => l.itemId).filter((x): x is number => !!x);
  const items = itemIds.length
    ? await trx
        .selectFrom('items')
        .select(['id', 'name', 'kind', 'hsn_sac', 'uqc', 'gst_rate_pct', 'sale_price', 'purchase_price'])
        .where('org_id', '=', orgId)
        .where('id', 'in', itemIds)
        .execute()
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  // Only the organisation's approved HSN/SAC codes may reach a line. GSTR-1
  // Table 12 is validated against the official master, and one bad code bounces
  // the whole return — so this is checked on the server, not only in the picker.
  const approved = await trx
    .selectFrom('hsn_codes')
    .select(['code', 'kind'])
    .where('org_id', '=', orgId)
    .where('is_active', '=', 1)
    .execute();
  const approvedCodes = new Set(approved.map((h) => h.code));

  const costed = lines.map((l, idx) => {
    const item = l.itemId ? itemById.get(l.itemId) : undefined;
    if (l.itemId && !item) throw badRequest(`Line ${idx + 1} refers to an item that does not exist.`);

    const hsn = l.hsnSac ?? item?.hsn_sac ?? null;
    if (hsn && !approvedCodes.has(hsn)) {
      throw badRequest(
        `Line ${idx + 1} uses HSN/SAC ${hsn}, which is not on the approved list. ` +
          'An admin can add it under Settings → HSN & SAC Codes.',
      );
    }
    if (l.qty <= 0) throw badRequest(`Line ${idx + 1} needs a quantity above zero.`);

    // An unpriced line takes the catalogue price. Without an item there is
    // nothing to fall back to, so the caller has to say what it is worth.
    const ratePaise = l.ratePaise ?? (item ? toPaiseFromSql(item[priceField]) : undefined);
    if (ratePaise === undefined) {
      throw badRequest(`Line ${idx + 1} needs a rate — there is no item to take one from.`);
    }

    const gstRatePct = l.gstRatePct ?? Number(item?.gst_rate_pct ?? 0);
    const { taxable, tax, total } = computeLineTax({
      ratePaise,
      qty: l.qty,
      discountPct: l.discountPct ?? 0,
      gstRatePct,
      supplyType,
    });

    return {
      itemId: l.itemId ?? null,
      description: l.description ?? item?.name ?? null,
      hsnSac: hsn,
      qty: l.qty,
      uqc: l.uqc ?? item?.uqc ?? 'NOS',
      ratePaise,
      discountPct: l.discountPct ?? 0,
      gstRatePct,
      taxable,
      tax,
      total,
      kind: (item ? (item.kind === 'service' ? 'service' : 'goods') : hsn?.startsWith('99') ? 'service' : 'goods') as
        'goods' | 'service',
    };
  });

  const kinds = new Set(costed.map((c) => c.kind));

  return {
    lines: costed,
    tax: sumTax(costed.map((c) => c.tax)),
    supplyKind: kinds.size > 1 ? 'both' : kinds.has('service') ? 'service' : 'goods',
  };
}
