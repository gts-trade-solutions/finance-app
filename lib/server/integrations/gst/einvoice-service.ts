import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// Registering an invoice, end to end.
//
// Five steps, in this order, and the order is the design:
//
//   1. load the invoice as the portal's schema wants to see it
//   2. check it ourselves, and refuse in our own words if it is wrong
//   3. build the document
//   4. call whichever provider this branch is connected to
//   5. store what came back, inside the caller's transaction
//
// Step 2 is why an attempt is not wasted on a document that could never be
// accepted. Step 5 is inside the transaction because an IRN that the portal
// issued and the books did not record is the worst state this can end in:
// the invoice is legally registered, cannot be registered again, and nothing
// in the app knows. The call log is written outside the transaction for the
// same reason — see `runPortalCall`.
// ─────────────────────────────────────────────────────────────────────────────

import { mulQty } from '../../../money';
import type { SupplyType } from '../../../types';
import { db, type Executor, type Trx } from '../../db';
import { badRequest, conflict, notFound } from '../../http';
import { toPaiseFromSql, toNumberFromSql } from '../../money-sql';
import {
  buildEinvoicePayload, fromIrpDate,
  type EinvoiceLine, type EinvoicePayload, type EinvoiceSource,
} from './einvoice-payload';
import { preflightEinvoice, summarise, type PreflightResult } from './preflight';
import {
  connectionFor, providerContext, resolveProvider, runPortalCall, toApiError,
} from './index';
import { PortalDuplicate, PortalRejection, parsePortalTimestamp } from './provider';

// ── Loading ──────────────────────────────────────────────────────────────────

interface LoadedInvoice {
  einvoiceId: number;
  einvoiceStatus: string;
  attempts: number;
  invoiceStatus: string;
  branchId: number;
  /**
   * Applied to everyone, not only to businesses above ₹10 crore.
   *
   * The 30-day hard stop is legally a ₹10-crore rule, and the organisation
   * record has no flag for that threshold — only ₹5 crore, which decides
   * e-invoicing itself. Erring strict is the safe direction: it tells a
   * smaller business its window is closing sooner than the law insists,
   * rather than letting one that has grown past ₹10 crore walk into a
   * deadline the app never mentioned. Worth revisiting when the organisation
   * carries its own turnover band.
   */
  aatoAbove5Cr: boolean;
  source: EinvoiceSource;
}

async function loadInvoice(
  ex: Executor,
  orgId: number,
  invoiceId: number,
): Promise<LoadedInvoice> {
  const head = await ex
    .selectFrom('einvoices as e')
    .innerJoin('invoices as i', 'i.id', 'e.invoice_id')
    .innerJoin('contacts as c', 'c.id', 'i.customer_id')
    .innerJoin('branches as b', 'b.id', 'i.branch_id')
    .innerJoin('organizations as o', 'o.id', 'i.org_id')
    .select([
      'e.id as einvoice_id', 'e.status as einvoice_status', 'e.attempts',
      'i.id as invoice_id', 'i.branch_id', 'i.number', 'i.invoice_date', 'i.status as invoice_status',
      'i.supply_type', 'i.supply_kind', 'i.place_of_supply',
      'i.doc_discount', 'i.shipping_charge', 'i.adjustment', 'i.round_off', 'i.total',
      'b.gstin as branch_gstin', 'b.name as branch_name', 'b.address as branch_address',
      'b.city as branch_city', 'b.pincode as branch_pincode', 'b.state_code as branch_state',
      'o.name as org_name', 'o.legal_name as org_legal_name', 'o.aato_above_5cr', 'o.email as org_email',
      'o.phone as org_phone',
      'c.display_name as customer_name', 'c.legal_name as customer_legal_name', 'c.gstin as customer_gstin',
      'c.billing_address', 'c.billing_city', 'c.billing_pincode', 'c.state_code as customer_state',
      'c.shipping_address', 'c.shipping_city', 'c.shipping_pincode',
      'c.email as customer_email', 'c.phone as customer_phone',
    ])
    .where('e.invoice_id', '=', invoiceId)
    .where('e.org_id', '=', orgId)
    .executeTakeFirst();

  if (!head) throw notFound('That invoice has no e-invoice record.');

  // The item is joined because a line raised from the catalogue stores only
  // `item_id` and leaves `description` null — the screens fall back to the
  // item's name, and so must this. The portal's product description is a
  // mandatory field, and "Line 1" is not a product.
  const lineRows = await ex
    .selectFrom('invoice_lines as l')
    .leftJoin('items as it', 'it.id', 'l.item_id')
    .select([
      'l.line_no', 'l.description', 'l.hsn_sac', 'l.qty', 'l.uqc', 'l.rate',
      'l.gst_rate_pct', 'l.taxable', 'l.cgst', 'l.sgst', 'l.igst', 'l.cess', 'l.line_total',
      'it.name as item_name',
    ])
    .where('l.invoice_id', '=', invoiceId)
    .orderBy('l.line_no')
    .execute();

  const lines: EinvoiceLine[] = lineRows.map((l) => {
    const ratePaise = toPaiseFromSql(l.rate);
    const qty = toNumberFromSql(l.qty);
    const taxablePaise = toPaiseFromSql(l.taxable);
    // Lines store a discount percentage, but the portal wants the amount. Take
    // it as the difference rather than recomputing from the percentage: the
    // stored taxable value is what the invoice was actually raised on, and a
    // recomputed figure could differ by a paisa and fail the portal's own
    // arithmetic check.
    const grossPaise = mulQty(ratePaise, qty);
    return {
      lineNo: l.line_no,
      description: l.description?.trim() || l.item_name || '',
      hsnSac: l.hsn_sac,
      qty,
      uqc: l.uqc,
      ratePaise,
      discountPaise: Math.max(0, grossPaise - taxablePaise),
      taxablePaise,
      gstRatePct: toNumberFromSql(l.gst_rate_pct),
      cgstPaise: toPaiseFromSql(l.cgst),
      sgstPaise: toPaiseFromSql(l.sgst),
      igstPaise: toPaiseFromSql(l.igst),
      cessPaise: toPaiseFromSql(l.cess),
      lineTotalPaise: toPaiseFromSql(l.line_total),
    };
  });

  // Transport details, if an e-way bill has already been prepared against this
  // invoice. Sending them with the registration means the portal issues both
  // documents from one call.
  const ewb = await ex
    .selectFrom('eway_bills')
    .select([
      'transporter_id', 'transporter_name', 'distance_km', 'transport_mode', 'vehicle_no',
      'eway_bill_no',
    ])
    .where('invoice_id', '=', invoiceId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();

  const shipDiffers =
    !!head.shipping_address && head.shipping_address !== head.billing_address;

  const source: EinvoiceSource = {
    docType: 'INV',
    number: head.number,
    date: String(head.invoice_date).slice(0, 10),
    supplyType: head.supply_type as SupplyType,
    supplyKind: head.supply_kind,
    placeOfSupply: head.place_of_supply,
    reverseCharge: false,
    seller: {
      gstin: head.branch_gstin,
      legalName: head.org_legal_name ?? head.org_name,
      tradeName: head.org_name,
      address1: head.branch_address,
      city: head.branch_city,
      pincode: head.branch_pincode,
      stateCode: head.branch_state,
      email: head.org_email,
      phone: head.org_phone,
    },
    buyer: {
      gstin: head.customer_gstin,
      legalName: head.customer_legal_name ?? head.customer_name,
      tradeName: head.customer_name,
      address1: head.billing_address,
      city: head.billing_city,
      pincode: head.billing_pincode,
      stateCode: head.customer_state,
      email: head.customer_email,
      phone: head.customer_phone,
    },
    shipTo: shipDiffers
      ? {
          gstin: head.customer_gstin,
          legalName: head.customer_legal_name ?? head.customer_name,
          address1: head.shipping_address,
          city: head.shipping_city,
          pincode: head.shipping_pincode,
          stateCode: head.customer_state,
        }
      : null,
    lines,
    docDiscountPaise: toPaiseFromSql(head.doc_discount),
    shippingChargePaise: toPaiseFromSql(head.shipping_charge),
    adjustmentPaise: toPaiseFromSql(head.adjustment),
    roundOffPaise: toPaiseFromSql(head.round_off),
    totalPaise: toPaiseFromSql(head.total),
    // Only sent when there is a vehicle to send, and never once the e-way bill
    // already exists — asking the portal to issue a second one is a rejection.
    transport:
      ewb && ewb.vehicle_no && !ewb.eway_bill_no
        ? {
            transporterId: ewb.transporter_id,
            transporterName: ewb.transporter_name,
            distanceKm: ewb.distance_km,
            mode: ewb.transport_mode,
            vehicleNo: ewb.vehicle_no,
          }
        : null,
  };

  return {
    einvoiceId: head.einvoice_id,
    einvoiceStatus: head.einvoice_status,
    attempts: head.attempts,
    invoiceStatus: head.invoice_status,
    branchId: head.branch_id,
    aatoAbove5Cr: head.aato_above_5cr === 1,
    source,
  };
}

// ── Eligibility ──────────────────────────────────────────────────────────────

/**
 * The things that make registration impossible rather than merely wrong.
 *
 * Kept separate from the pre-flight check because these are about the state of
 * the document in *our* books — already registered, still a draft, voided —
 * and they throw rather than collecting problems. There is nothing to fix on a
 * document that has already been given an IRN.
 */
function assertRegisterable(loaded: LoadedInvoice, number: string): void {
  if (loaded.einvoiceStatus === 'submitted') throw conflict(`${number} already has an IRN.`);
  if (loaded.einvoiceStatus === 'cancelled') {
    throw conflict(`${number} was cancelled and cannot be registered again.`);
  }
  if (loaded.invoiceStatus === 'draft') {
    throw badRequest('A draft invoice cannot be registered — issue it first.');
  }
  if (loaded.invoiceStatus === 'void') throw badRequest('A void invoice cannot be registered.');
}

// ── Preview ──────────────────────────────────────────────────────────────────

export interface EinvoicePreview {
  invoiceId: number;
  number: string;
  /** What would go to the portal. Shown as-is; it is the thing being debugged. */
  payload: EinvoicePayload;
  preflight: PreflightResult;
  provider: string;
  /** False when nothing this submits reaches a government system. */
  live: boolean;
  connected: boolean;
}

/**
 * Build and check an invoice without submitting it.
 *
 * The useful half of this integration before any contract exists: it answers
 * "would this be accepted, and if not, why" without spending an attempt, and
 * it does it in our own words rather than the portal's error codes.
 */
export async function previewEinvoice(
  ex: Executor,
  orgId: number,
  invoiceId: number,
): Promise<EinvoicePreview> {
  const loaded = await loadInvoice(ex, orgId, invoiceId);
  const connection = await connectionFor(ex, orgId, loaded.branchId, 'einvoice');
  const provider = resolveProvider(connection.providerName);

  return {
    invoiceId,
    number: loaded.source.number,
    payload: buildEinvoicePayload(loaded.source),
    preflight: preflightEinvoice(loaded.source, {
      aatoAbove10Cr: true,
      aatoAbove5Cr: loaded.aatoAbove5Cr,
    }),
    provider: provider.name,
    live: provider.live,
    connected: connection.configured,
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

export interface RegisterResult {
  irn: string;
  ackNo: string;
  status: string;
  provider: string;
  live: boolean;
  /** Accepted, but worth telling the user about. Never blocks. */
  warnings: string[];
  /** Set when the portal issued an e-way bill from the same call. */
  ewayBillNo: string | null;
}

/**
 * Register one invoice. Give it a transaction of its own.
 *
 * Failures are recorded through the module-level connection, outside `trx`,
 * so that the rollback which follows a failure cannot erase them. That makes
 * one thing unsafe: calling this inside a transaction that has already written
 * the invoice's e-invoice row — "register as soon as it is issued", say. The
 * failure write would wait on a row lock held by the very transaction waiting
 * for it, and the request would hang until MySQL's lock timeout. Issue first,
 * commit, then register.
 */
export async function registerInvoice(
  trx: Trx,
  orgId: number,
  invoiceId: number,
): Promise<RegisterResult> {
  const loaded = await loadInvoice(trx, orgId, invoiceId);
  const { source } = loaded;
  assertRegisterable(loaded, source.number);

  const check = preflightEinvoice(source, {
    aatoAbove10Cr: true,
    aatoAbove5Cr: loaded.aatoAbove5Cr,
  });

  if (!check.ok) {
    // Recorded as a failed attempt with the reason, because the register's
    // whole purpose is showing what is stuck and why. A refusal that leaves no
    // trace looks like nothing happened.
    //
    // Written through `db`, not `trx`. The throw below rolls the caller's
    // transaction back, and a record written inside it would be rolled back
    // with it — which is exactly what happened here at first, silently: every
    // refusal was recorded and then un-recorded in the same breath.
    await db
      .updateTable('einvoices')
      .set({
        status: 'failed',
        attempts: loaded.attempts + 1,
        error_code: 'preflight',
        error_message: check.errors.map((e) => e.message).join(' ').slice(0, 1000),
      })
      .where('id', '=', loaded.einvoiceId)
      .execute();

    throw badRequest(`${source.number} cannot be registered yet. ${summarise(check)}`, {
      errors: check.errors,
      warnings: check.warnings,
    });
  }

  const connection = await connectionFor(trx, orgId, loaded.branchId, 'einvoice');
  const provider = resolveProvider(connection.providerName);
  const payload = buildEinvoicePayload(source);
  const ctx = await providerContext(trx, connection);

  let result;
  try {
    result = await runPortalCall(
      {
        orgId,
        connection,
        operation: 'generate_irn',
        referenceType: 'invoice',
        referenceId: invoiceId,
      },
      payload,
      () => provider.generateIrn(payload, ctx),
    );
  } catch (err) {
    if (err instanceof PortalDuplicate) {
      return recoverDuplicate(trx, loaded, provider.name, provider.live, err, check.warnings);
    }
    await recordFailure(db, loaded, err);
    throw toApiError(err, source.number);
  }

  await trx
    .updateTable('einvoices')
    .set({
      status: 'submitted',
      provider: provider.name,
      irn: result.irn,
      ack_no: result.ackNo,
      ack_date: parsePortalTimestamp(result.ackDate),
      signed_qr_payload: result.signedQr,
      signed_invoice: result.signedInvoice,
      attempts: loaded.attempts + 1,
      error_code: null,
      error_message: null,
    })
    .where('id', '=', loaded.einvoiceId)
    .execute();

  // The portal issues both documents when transport details ride along with
  // the invoice. Storing the number here is what stops the e-way bill screen
  // asking for one that already exists.
  if (result.ewbNo) {
    await trx
      .updateTable('eway_bills')
      .set({
        eway_bill_no: result.ewbNo,
        status: 'generated',
        provider: provider.name,
        generated_at: new Date(),
        part_b_at: new Date(),
        valid_until: result.ewbValidUntil
          ? parsePortalTimestamp(result.ewbValidUntil)
          : null,
        error_message: null,
      })
      .where('invoice_id', '=', invoiceId)
      .where('org_id', '=', orgId)
      .execute();

    await trx
      .updateTable('invoices')
      .set({ eway_bill_no: result.ewbNo })
      .where('id', '=', invoiceId)
      .execute();
  }

  return {
    irn: result.irn,
    ackNo: result.ackNo,
    status: 'submitted',
    provider: provider.name,
    live: provider.live,
    warnings: check.warnings.map((w) => w.message),
    ewayBillNo: result.ewbNo,
  };
}

/**
 * The portal already holds this invoice — so record the IRN it holds.
 *
 * This is the recovery path for the worst state the integration can reach: a
 * registration that succeeded at the portal but whose reply never reached the
 * books — a timeout after NIC committed, a crash, a rolled-back write. The
 * invoice is legally registered and cannot be registered again, and without
 * this it would sit in the register as "failed" forever, retried into the
 * same refusal on every attempt.
 *
 * The portal returns the IRN and acknowledgement with the refusal, but not the
 * signed invoice or the QR code. Those are left empty and the user is told,
 * because printing an invoice without its QR is a real defect and a silent
 * one would be discovered by a customer, not by us.
 */
async function recoverDuplicate(
  trx: Trx,
  loaded: LoadedInvoice,
  providerName: string,
  live: boolean,
  dup: PortalDuplicate,
  warnings: { message: string }[],
): Promise<RegisterResult> {
  await trx
    .updateTable('einvoices')
    .set({
      status: 'submitted',
      provider: providerName,
      irn: dup.irn,
      ack_no: dup.ackNo,
      ack_date: dup.ackDate ? parsePortalTimestamp(dup.ackDate) : null,
      signed_qr_payload: null,
      signed_invoice: null,
      attempts: loaded.attempts + 1,
      error_code: '2150',
      error_message:
        'Recovered: the portal already held this invoice, most likely from an earlier attempt whose ' +
        'reply was lost. The IRN is recorded; the signed copy and QR code still need fetching.',
    })
    .where('id', '=', loaded.einvoiceId)
    .execute();

  return {
    irn: dup.irn,
    ackNo: dup.ackNo ?? '',
    status: 'submitted',
    provider: providerName,
    live,
    warnings: [
      'The portal already had this invoice registered, so its existing IRN was recorded instead of a ' +
        'new one. The QR code is not available yet — do not print the invoice until it is fetched.',
      ...warnings.map((w) => w.message),
    ],
    ewayBillNo: null,
  };
}

/**
 * Write down why a submission failed.
 *
 * A portal rejection keeps its code, because the same code appearing across
 * several customers is how a schema change or an outage is noticed. Anything
 * else is recorded without one, and the message is kept rather than replaced
 * with something generic: the retry history is exactly what an assessment asks
 * about, so it is never overwritten.
 */
async function recordFailure(ex: Executor, loaded: LoadedInvoice, err: unknown): Promise<void> {
  const rejection = err instanceof PortalRejection ? err : null;
  await ex
    .updateTable('einvoices')
    .set({
      status: 'failed',
      attempts: loaded.attempts + 1,
      error_code: rejection?.code ?? null,
      error_message: (err as Error).message?.slice(0, 1000) ?? 'The portal call failed.',
    })
    .where('id', '=', loaded.einvoiceId)
    .execute();
}

export { fromIrpDate };
