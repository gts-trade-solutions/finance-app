import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// Generating an e-way bill, from an invoice or from a delivery challan.
//
// The challan half is the part most software leaves out, and it is where the
// risk actually sits. Sending material out for job work is not a sale — there
// is no invoice, no revenue and no tax — but the lorry still has to be
// declared, and for inter-state job work it has to be declared whatever the
// goods are worth. A register built only on invoices shows a clean screen
// while a vehicle is travelling illegally.
// ─────────────────────────────────────────────────────────────────────────────

import type { Paise } from '../../../types';
import {
  assessEwayBill, normaliseVehicleNo,
  type EwayBillAssessment, type MovementReason,
} from '../../../tax/eway';
import { db, type Executor, type Trx } from '../../db';
import { badRequest, conflict, notFound } from '../../http';
import { toNumberFromSql, toPaiseFromSql } from '../../money-sql';
import {
  buildEwayBillPayload,
  type EwayBillPayload, type EwayBillSource, type EwbDocType, type EwbLine,
  type StoredSubSupplyType,
} from './eway-payload';
import {
  connectionFor, providerContext, resolveProvider, runPortalCall, toApiError,
} from './index';
import { PortalRejection, parsePortalTimestamp } from './provider';

// ── What the caller asks for ─────────────────────────────────────────────────

export type EwayBillDocument = { kind: 'invoice'; id: number } | { kind: 'challan'; id: number };

export interface TransportInput {
  vehicleNo?: string | null;
  transporterId?: string | null;
  transporterName?: string | null;
  transportDocNo?: string | null;
  transportDocDate?: string | null;
  mode?: 'road' | 'rail' | 'air' | 'ship';
  distanceKm?: number | null;
  isOverDimensional?: boolean;
}

/**
 * A delivery challan's purpose, mapped to NIC's reason-for-movement code.
 *
 * `supply_on_approval` becomes line sales: goods sent out for the customer to
 * choose from, with the sale crystallising only on what they keep. NIC has no
 * closer code, and "others" would lose the distinction entirely.
 *
 * `liquid_gas` is an ordinary supply — the challan exists only because the
 * quantity is not known until it is delivered, not because the movement is
 * something other than a sale.
 */
const CHALLAN_REASON: Record<string, StoredSubSupplyType> = {
  job_work: 'job_work',
  supply_on_approval: 'line_sales',
  liquid_gas: 'supply',
  other: 'others',
};

// ── Loading ──────────────────────────────────────────────────────────────────

interface Loaded {
  rowId: number | null;
  status: string;
  existingNo: string | null;
  branchId: number;
  docLabel: string;
  docType: EwbDocType;
  reason: MovementReason;
  supplyKind: 'goods' | 'service' | 'both';
  /** SEZ and export supplies are inter-state by statute, wherever the lorry goes. */
  interStateSupply: boolean;
  consignmentPaise: Paise;
  fromStateCode: string;
  toStateCode: string;
  fromPincode: string | null;
  toPincode: string | null;
  source: Omit<EwayBillSource, 'transport'>;
}

async function loadDocument(
  ex: Executor,
  orgId: number,
  doc: EwayBillDocument,
): Promise<Loaded> {
  return doc.kind === 'invoice'
    ? loadFromInvoice(ex, orgId, doc.id)
    : loadFromChallan(ex, orgId, doc.id);
}

async function commonParties(
  ex: Executor,
  orgId: number,
  branchId: number,
  customerId: number,
) {
  const branch = await ex
    .selectFrom('branches as b')
    .innerJoin('organizations as o', 'o.id', 'b.org_id')
    .select([
      'b.gstin', 'b.address', 'b.city', 'b.pincode', 'b.state_code',
      'o.name as org_name', 'o.legal_name as org_legal_name',
    ])
    .where('b.id', '=', branchId)
    .where('b.org_id', '=', orgId)
    .executeTakeFirstOrThrow();

  const customer = await ex
    .selectFrom('contacts')
    .select([
      'display_name', 'legal_name', 'gstin', 'state_code',
      'billing_address', 'billing_city', 'billing_pincode',
      'shipping_address', 'shipping_city', 'shipping_pincode',
    ])
    .where('id', '=', customerId)
    .where('org_id', '=', orgId)
    .executeTakeFirstOrThrow();

  // Ship-to wins wherever it is filled in. The bill has to describe where the
  // goods are actually going, which is not always where the invoice is sent —
  // and it is the delivery address an officer checks against the route.
  const toPlace = customer.shipping_city ?? customer.billing_city;
  const toPincode = customer.shipping_pincode ?? customer.billing_pincode;
  const toAddress = customer.shipping_address ?? customer.billing_address;

  return {
    from: {
      gstin: branch.gstin,
      tradeName: branch.org_legal_name ?? branch.org_name,
      address1: branch.address,
      place: branch.city,
      pincode: branch.pincode,
      stateCode: branch.state_code,
    },
    to: {
      gstin: customer.gstin,
      tradeName: customer.legal_name ?? customer.display_name,
      address1: toAddress,
      place: toPlace,
      pincode: toPincode,
      stateCode: customer.state_code,
    },
    fromStateCode: branch.state_code,
    toStateCode: customer.state_code,
    fromPincode: branch.pincode,
    toPincode,
  };
}

async function loadFromInvoice(ex: Executor, orgId: number, invoiceId: number): Promise<Loaded> {
  const inv = await ex
    .selectFrom('invoices')
    .select([
      'id', 'branch_id', 'customer_id', 'number', 'invoice_date', 'status', 'supply_kind',
      'supply_type', 'place_of_supply', 'subtotal', 'cgst', 'sgst', 'igst', 'cess',
      'shipping_charge', 'adjustment', 'total',
    ])
    .where('id', '=', invoiceId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();
  if (!inv) throw notFound('That invoice does not exist.');
  if (inv.status === 'draft' || inv.status === 'void') {
    throw badRequest('Only an issued invoice can carry an e-way bill.');
  }

  const parties = await commonParties(ex, orgId, inv.branch_id, inv.customer_id);
  const intra = inv.supply_type === 'intra';

  // Joined for the same reason as the e-invoice loader: a catalogue line
  // carries no description of its own, and an officer at a checkpost reading
  // "Line 1" instead of a product name is a conversation nobody wants.
  const lineRows = await ex
    .selectFrom('invoice_lines as l')
    .leftJoin('items as it', 'it.id', 'l.item_id')
    .select([
      'l.line_no', 'l.description', 'l.hsn_sac', 'l.qty', 'l.uqc', 'l.gst_rate_pct', 'l.taxable',
      'it.name as item_name',
    ])
    .where('l.invoice_id', '=', invoiceId)
    .orderBy('l.line_no')
    .execute();

  const lines: EwbLine[] = lineRows.map((l) => ({
    name: (l.description?.trim() || l.item_name || `Line ${l.line_no}`).slice(0, 100),
    description: l.description?.trim() || l.item_name || '',
    hsnSac: l.hsn_sac,
    qty: toNumberFromSql(l.qty),
    uqc: l.uqc,
    gstRatePct: toNumberFromSql(l.gst_rate_pct),
    intra,
    taxablePaise: toPaiseFromSql(l.taxable),
  }));

  const existing = await ex
    .selectFrom('eway_bills')
    .select(['id', 'status', 'eway_bill_no'])
    .where('invoice_id', '=', invoiceId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();

  const reason: MovementReason =
    inv.supply_type === 'export_lut' || inv.supply_type === 'export_with_tax' ? 'export' : 'supply';

  return {
    rowId: existing?.id ?? null,
    status: existing?.status ?? 'pending',
    existingNo: existing?.eway_bill_no ?? null,
    branchId: inv.branch_id,
    docLabel: inv.number,
    docType: 'INV',
    reason,
    supplyKind: inv.supply_kind,
    interStateSupply: ['sez', 'export_lut', 'export_with_tax'].includes(inv.supply_type),
    consignmentPaise: toPaiseFromSql(inv.total),
    fromStateCode: parties.fromStateCode,
    toStateCode: parties.toStateCode,
    fromPincode: parties.fromPincode,
    toPincode: parties.toPincode,
    source: {
      direction: 'O',
      subSupplyType: reason === 'export' ? 'export' : 'supply',
      docType: 'INV',
      docNo: inv.number,
      docDate: String(inv.invoice_date).slice(0, 10),
      from: parties.from,
      to: parties.to,
      taxablePaise: toPaiseFromSql(inv.subtotal),
      cgstPaise: toPaiseFromSql(inv.cgst),
      sgstPaise: toPaiseFromSql(inv.sgst),
      igstPaise: toPaiseFromSql(inv.igst),
      cessPaise: toPaiseFromSql(inv.cess),
      otherChargesPaise: toPaiseFromSql(inv.shipping_charge) + toPaiseFromSql(inv.adjustment),
      totalPaise: toPaiseFromSql(inv.total),
      lines,
    },
  };
}

async function loadFromChallan(ex: Executor, orgId: number, challanId: number): Promise<Loaded> {
  const ch = await ex
    .selectFrom('delivery_challans')
    .select([
      'id', 'branch_id', 'customer_id', 'number', 'challan_date', 'challan_type',
      'status', 'place_of_supply', 'total',
    ])
    .where('id', '=', challanId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();
  if (!ch) throw notFound('That delivery challan does not exist.');
  if (ch.status === 'cancelled') {
    throw badRequest('A cancelled challan cannot carry an e-way bill.');
  }

  const parties = await commonParties(ex, orgId, ch.branch_id, ch.customer_id);

  const lineRows = await ex
    .selectFrom('challan_lines as l')
    .leftJoin('items as it', 'it.id', 'l.item_id')
    .select([
      'l.line_no', 'l.description', 'l.hsn_sac', 'l.qty', 'l.uqc', 'l.line_total',
      'it.name as item_name',
    ])
    .where('l.challan_id', '=', challanId)
    .orderBy('l.line_no')
    .execute();

  // A challan carries no tax — it is not a supply. The value is declared so the
  // consignment can be valued at a checkpost, and the rate columns go as zero.
  const lines: EwbLine[] = lineRows.map((l) => ({
    name: (l.description?.trim() || l.item_name || `Line ${l.line_no}`).slice(0, 100),
    description: l.description?.trim() || l.item_name || '',
    hsnSac: l.hsn_sac,
    qty: toNumberFromSql(l.qty),
    uqc: l.uqc,
    gstRatePct: 0,
    intra: parties.fromStateCode === parties.toStateCode,
    taxablePaise: toPaiseFromSql(l.line_total),
  }));

  const existing = await ex
    .selectFrom('eway_bills')
    .select(['id', 'status', 'eway_bill_no'])
    .where('challan_id', '=', challanId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();

  const reason = (CHALLAN_REASON[ch.challan_type] ?? 'others') as StoredSubSupplyType;
  const total = toPaiseFromSql(ch.total);

  return {
    rowId: existing?.id ?? null,
    status: existing?.status ?? 'pending',
    existingNo: existing?.eway_bill_no ?? null,
    branchId: ch.branch_id,
    docLabel: ch.number,
    docType: 'CHL',
    reason: reason as MovementReason,
    supplyKind: 'goods',
    interStateSupply: false,
    consignmentPaise: total,
    fromStateCode: parties.fromStateCode,
    toStateCode: parties.toStateCode,
    fromPincode: parties.fromPincode,
    toPincode: parties.toPincode,
    source: {
      direction: 'O',
      subSupplyType: reason,
      docType: 'CHL',
      docNo: ch.number,
      docDate: String(ch.challan_date).slice(0, 10),
      from: parties.from,
      to: parties.to,
      taxablePaise: total,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      cessPaise: 0,
      otherChargesPaise: 0,
      totalPaise: total,
      lines,
    },
  };
}

// ── Assessment, without generating anything ──────────────────────────────────

export interface EwayBillCheck {
  document: EwayBillDocument;
  label: string;
  assessment: EwayBillAssessment;
  /** Fields the portal needs that are not filled in yet. */
  missing: string[];
  existingNo: string | null;
  provider: string;
  live: boolean;
}

export async function checkEwayBill(
  ex: Executor,
  orgId: number,
  doc: EwayBillDocument,
): Promise<EwayBillCheck> {
  const loaded = await loadDocument(ex, orgId, doc);
  const connection = await connectionFor(ex, orgId, loaded.branchId, 'ewaybill');
  const provider = resolveProvider(connection.providerName);

  return {
    document: doc,
    label: loaded.docLabel,
    assessment: assessEwayBill({
      supplyKind: loaded.supplyKind,
      consignmentPaise: loaded.consignmentPaise,
      fromStateCode: loaded.fromStateCode,
      toStateCode: loaded.toStateCode,
      reason: loaded.reason,
      interStateSupply: loaded.interStateSupply,
      docDate: loaded.source.docDate,
    }),
    missing: missingFields(loaded),
    existingNo: loaded.existingNo,
    provider: provider.name,
    live: provider.live,
  };
}

/**
 * The Part A fields NIC will not accept a blank for.
 *
 * Reported as a list rather than thrown one at a time, so a user fixes an
 * address once instead of discovering the next missing field on each attempt.
 */
function missingFields(loaded: Loaded): string[] {
  const missing: string[] = [];
  const s = loaded.source;

  if (!s.from.gstin) missing.push('This branch has no GSTIN.');
  if (!s.from.address1) missing.push('This branch has no address.');
  if (!s.from.place) missing.push('This branch has no city.');
  if (!s.from.pincode) missing.push('This branch has no PIN code.');
  if (!s.to.address1) missing.push('The customer has no delivery address.');
  if (!s.to.place) missing.push('The customer has no city.');
  if (!s.to.pincode) missing.push('The customer has no PIN code.');

  for (const l of s.lines) {
    if (!l.hsnSac) {
      missing.push(`"${l.name}" has no HSN code.`);
      break; // one is enough to make the point; the rest surface after a fix
    }
  }
  return missing;
}

// ── Generating ───────────────────────────────────────────────────────────────

export interface GenerateEwayBillResult {
  ewayBillNo: string;
  status: 'generated';
  validUntil: string;
  provider: string;
  live: boolean;
  assessment: EwayBillAssessment;
}

export async function generateEwayBill(
  trx: Trx,
  orgId: number,
  doc: EwayBillDocument,
  transport: TransportInput,
): Promise<GenerateEwayBillResult> {
  const loaded = await loadDocument(trx, orgId, doc);

  if (loaded.status === 'generated' && loaded.existingNo) {
    throw conflict(
      `${loaded.docLabel} already has e-way bill ${loaded.existingNo}. A second one for the same ` +
        'consignment is a rejection — cancel the first if it is wrong.',
    );
  }

  const assessment = assessEwayBill({
    supplyKind: loaded.supplyKind,
    consignmentPaise: loaded.consignmentPaise,
    fromStateCode: loaded.fromStateCode,
    toStateCode: loaded.toStateCode,
    reason: loaded.reason,
    interStateSupply: loaded.interStateSupply,
    docDate: loaded.source.docDate,
  });

  if (assessment.blockers.length > 0) {
    throw badRequest(assessment.blockers.join(' '));
  }

  const missing = missingFields(loaded);
  if (missing.length > 0) {
    throw badRequest(
      `${loaded.docLabel} is missing details the portal requires. ${missing.slice(0, 3).join(' ')}`,
      { missing },
    );
  }

  // Part B. Without a vehicle or a transport document the bill authorises no
  // movement, and — more to the point — validity does not start, so generating
  // one now would put a bill on the register that nobody can rely on.
  const vehicleNo = transport.vehicleNo?.trim()
    ? normaliseVehicleNo(transport.vehicleNo)
    : null;
  if (transport.vehicleNo?.trim() && !vehicleNo) {
    throw badRequest(
      `"${transport.vehicleNo}" is not a vehicle number the portal will take. It should look like ` +
        'TN01AB1234 — between 7 and 11 letters and digits.',
    );
  }
  if (!vehicleNo && !transport.transportDocNo?.trim()) {
    throw badRequest(
      'Part B needs either a vehicle number, or the transport document number for rail, air or ship. ' +
        'Until one is supplied the bill does not authorise the goods to move, and its validity has not ' +
        'started counting.',
    );
  }

  const source: EwayBillSource = {
    ...loaded.source,
    transport: {
      transporterId: transport.transporterId ?? null,
      transporterName: transport.transporterName ?? null,
      transportDocNo: transport.transportDocNo ?? null,
      transportDocDate: transport.transportDocDate ?? null,
      mode: transport.mode ?? 'road',
      vehicleNo,
      isOverDimensional: transport.isOverDimensional ?? false,
      distanceKm: transport.distanceKm ?? null,
    },
  };

  const connection = await connectionFor(trx, orgId, loaded.branchId, 'ewaybill');
  const provider = resolveProvider(connection.providerName);
  const payload: EwayBillPayload = buildEwayBillPayload(source);
  const ctx = await providerContext(trx, connection);

  let result;
  try {
    result = await runPortalCall(
      {
        orgId,
        connection,
        operation: 'generate_ewb',
        referenceType: doc.kind,
        referenceId: doc.id,
      },
      payload,
      () => provider.generateEwayBill(payload, ctx),
    );
  } catch (err) {
    // Written through db, not trx: the throw below rolls the caller's
    // transaction back, and a failure recorded inside it would vanish with it.
    await recordFailure(db, orgId, doc, loaded, err);
    throw toApiError(err, loaded.docLabel);
  }

  const now = new Date();
  const values = {
    org_id: orgId,
    invoice_id: doc.kind === 'invoice' ? doc.id : null,
    challan_id: doc.kind === 'challan' ? doc.id : null,
    eway_bill_no: result.ewbNo,
    status: 'generated' as const,
    provider: provider.name,
    sub_supply_type: source.subSupplyType,
    transport_mode: transport.mode ?? ('road' as const),
    vehicle_no: vehicleNo,
    transporter_id: transport.transporterId ?? null,
    transporter_name: transport.transporterName ?? null,
    distance_km: transport.distanceKm ?? null,
    from_pincode: loaded.fromPincode,
    to_pincode: loaded.toPincode,
    generated_at: now,
    // Part B arrived with this call, so this is when the clock starts.
    part_b_at: now,
    valid_until: parsePortalTimestamp(result.validUntil),
    error_message: null,
  };

  if (loaded.rowId !== null) {
    await trx.updateTable('eway_bills').set(values).where('id', '=', loaded.rowId).execute();
  } else {
    await trx.insertInto('eway_bills').values(values).execute();
  }

  // Kept on the invoice too, because it has to print on the document and a
  // join to fetch one string on every invoice PDF is not worth it.
  if (doc.kind === 'invoice') {
    await trx
      .updateTable('invoices')
      .set({ eway_bill_no: result.ewbNo })
      .where('id', '=', doc.id)
      .execute();
  }

  return {
    ewayBillNo: result.ewbNo,
    status: 'generated',
    validUntil: result.validUntil,
    provider: provider.name,
    live: provider.live,
    assessment,
  };
}

async function recordFailure(
  ex: Executor,
  orgId: number,
  doc: EwayBillDocument,
  loaded: Loaded,
  err: unknown,
): Promise<void> {
  const rejection = err instanceof PortalRejection ? err : null;
  const message = `${rejection ? `[${rejection.code}] ` : ''}${(err as Error).message ?? 'The portal call failed.'}`;

  if (loaded.rowId !== null) {
    await ex
      .updateTable('eway_bills')
      .set({ status: 'pending', error_message: message.slice(0, 1000) })
      .where('id', '=', loaded.rowId)
      .execute();
    return;
  }

  await ex
    .insertInto('eway_bills')
    .values({
      org_id: orgId,
      invoice_id: doc.kind === 'invoice' ? doc.id : null,
      challan_id: doc.kind === 'challan' ? doc.id : null,
      status: 'pending',
      sub_supply_type: loaded.source.subSupplyType,
      error_message: message.slice(0, 1000),
    })
    .execute();
}
