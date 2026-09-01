import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// Sales services: invoices, and the journal entries behind them.
//
// The GST engine in lib/tax/gst.ts is reused as-is. It is pure logic — state
// codes, the supply-type resolver, per-line tax computation — with no browser
// dependency, and it was written during the MVP precisely so it would survive
// into this build. Reimplementing it here would give two places for the tax to
// be computed and one of them would drift.
//
// Every function takes a transaction. The document write and its posting are a
// single atomic unit: an invoice must never exist without its journal entry,
// and an entry must never exist without the document that explains it.
// ─────────────────────────────────────────────────────────────────────────────

import type { Trx } from '../db';
import type { Paise, SupplyKind, SupplyType } from '../../types';
import { resolveSupplyType, totalTaxPaise } from '../../tax/gst';
import { costLines, type DocumentLineInput } from './lines';
import { roundToRupee } from '../../money';
import { toPaiseFromSql, toSqlFromPaise } from '../money-sql';
import { allocateNumber, postEntry, reverseEntry, type DraftLine } from '../ledger/posting';
import { CODE, accountIds, requireAccount } from '../ledger/chart-of-accounts';
import { ApiError, badRequest, notFound } from '../http';

/** '26-27' for any date in the 2026-27 financial year. */
export function fyLabelFor(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const start = m < 4 ? y - 1 : y;
  return `${String(start).slice(2)}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export type InvoiceLineInput = DocumentLineInput;

export interface CreateInvoiceInput {
  branchId: number;
  customerId: number;
  date: string;
  dueDate: string;
  lines: InvoiceLineInput[];
  placeOfSupply?: string;
  supplyKind?: SupplyKind;
  status?: 'draft' | 'approved';
  number?: string;
  orderNumber?: string | null;
  subject?: string | null;
  paymentTerms?: string | null;
  salespersonId?: number | null;
  notes?: string | null;
  terms?: string | null;
  shippingChargePaise?: Paise;
  adjustmentPaise?: Paise;
  adjustmentLabel?: string | null;
  tcsPaise?: Paise;
  exportWithTax?: boolean;
  sourceDocType?: string | null;
  sourceDocId?: number | null;
}

export interface CreatedInvoice {
  id: number;
  number: string;
  totalPaise: Paise;
  journalEntryId: number | null;
}

/**
 * Create an invoice, and post it if it is not a draft.
 *
 * A draft deliberately posts nothing. It is a document somebody is still
 * writing, not a sale that has happened, and putting it in the ledger would
 * overstate revenue and the GST liability that follows from it.
 */
export async function createInvoice(
  trx: Trx,
  orgId: number,
  userId: number | null,
  input: CreateInvoiceInput,
): Promise<CreatedInvoice> {
  if (!input.lines.length) throw badRequest('An invoice needs at least one line.');

  const branch = await trx
    .selectFrom('branches')
    .select(['id', 'state_code', 'gstin'])
    .where('id', '=', input.branchId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();
  if (!branch) throw notFound('That branch does not exist.');

  const customer = await trx
    .selectFrom('contacts')
    .select(['id', 'display_name', 'state_code', 'gst_treatment'])
    .where('id', '=', input.customerId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();
  if (!customer) throw notFound('That customer does not exist.');

  const placeOfSupply = input.placeOfSupply || customer.state_code;
  const supplyType = resolveSupplyType({
    branchStateCode: branch.state_code,
    placeOfSupply,
    customerTreatment: customer.gst_treatment as never,
    exportWithTax: input.exportWithTax,
  }) as SupplyType;

  const costed = await costLines(trx, orgId, supplyType, input.lines);
  const computed = costed.lines;

  const tax = costed.tax;
  const shipping = input.shippingChargePaise ?? 0;
  const adjustment = input.adjustmentPaise ?? 0;
  const tcs = input.tcsPaise ?? 0;
  const gross = tax.taxablePaise + totalTaxPaise(tax) + shipping + adjustment + tcs;
  const { rounded, roundOff } = roundToRupee(gross);

  // Goods, services, or a mix — inferred from the lines when the caller is
  // silent. It decides which GSTR-1 table the supply is reported in.
  const supplyKind: SupplyKind = input.supplyKind ?? costed.supplyKind;

  const status = input.status ?? 'draft';
  const number =
    input.number?.trim() ||
    (await allocateNumber(trx, orgId, input.branchId, 'INV', fyLabelFor(input.date), {
      prefix: 'INV',
    }));

  const inserted = await trx
    .insertInto('invoices')
    .values({
      org_id: orgId,
      branch_id: input.branchId,
      number,
      customer_id: input.customerId,
      invoice_date: input.date,
      due_date: input.dueDate,
      place_of_supply: placeOfSupply,
      supply_type: supplyType,
      supply_kind: supplyKind,
      status,
      subtotal: toSqlFromPaise(tax.taxablePaise),
      doc_discount: toSqlFromPaise(0),
      cgst: toSqlFromPaise(tax.cgstPaise),
      sgst: toSqlFromPaise(tax.sgstPaise),
      igst: toSqlFromPaise(tax.igstPaise),
      cess: toSqlFromPaise(tax.cessPaise),
      tcs: toSqlFromPaise(tcs),
      shipping_charge: toSqlFromPaise(shipping),
      adjustment: toSqlFromPaise(adjustment),
      adjustment_label: input.adjustmentLabel ?? null,
      round_off: toSqlFromPaise(roundOff),
      total: toSqlFromPaise(rounded),
      amount_paid: toSqlFromPaise(0),
      order_number: input.orderNumber ?? null,
      subject: input.subject ?? null,
      payment_terms: input.paymentTerms ?? null,
      salesperson_id: input.salespersonId ?? null,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      source_doc_type: input.sourceDocType ?? null,
      source_doc_id: input.sourceDocId ?? null,
      created_by_user_id: userId,
    })
    .executeTakeFirstOrThrow();
  const invoiceId = Number(inserted.insertId);

  await trx
    .insertInto('invoice_lines')
    .values(
      computed.map((c, i) => ({
        org_id: orgId,
        invoice_id: invoiceId,
        line_no: i + 1,
        item_id: c.itemId,
        description: c.description,
        hsn_sac: c.hsnSac,
        qty: c.qty,
        uqc: c.uqc,
        rate: toSqlFromPaise(c.ratePaise),
        discount_pct: c.discountPct,
        gst_rate_pct: c.gstRatePct,
        taxable: toSqlFromPaise(c.taxable),
        cgst: toSqlFromPaise(c.tax.cgstPaise),
        sgst: toSqlFromPaise(c.tax.sgstPaise),
        igst: toSqlFromPaise(c.tax.igstPaise),
        cess: toSqlFromPaise(c.tax.cessPaise),
        line_total: toSqlFromPaise(c.total),
      })),
    )
    .execute();

  // An invoice above the e-invoicing threshold needs an IRN before it is
  // legally valid, so the register row is created up front rather than when
  // somebody remembers to submit it.
  await trx
    .insertInto('einvoices')
    .values({
      org_id: orgId,
      invoice_id: invoiceId,
      // A draft is not an issued document, so it is not awaiting anything yet.
      // The status moves to pending when the invoice is actually posted.
      status:
        status !== 'draft' && branch.gstin && customer.gst_treatment === 'registered'
          ? 'pending'
          : 'not_applicable',
    })
    .execute();

  let journalEntryId: number | null = null;
  if (status !== 'draft') {
    journalEntryId = await postInvoice(trx, orgId, userId, invoiceId);
  }

  return { id: invoiceId, number, totalPaise: rounded, journalEntryId };
}

/**
 * Post an invoice to the ledger.
 *
 * The entry the accountant expects:
 *   Dr Accounts Receivable      what the customer owes, including tax
 *     Cr Sales                  the taxable value, which is the actual revenue
 *     Cr Output CGST/SGST/IGST  tax collected on the government's behalf
 *     Cr Shipping income        billed separately from the goods
 *     Cr TCS payable            also collected for the government
 *     Cr/Dr Rounding            the paisa lost rounding the total to the rupee
 *
 * Tax is a liability, not income. Treating collected GST as revenue overstates
 * profit and understates what is owed at the end of the month.
 */
export async function postInvoice(
  trx: Trx,
  orgId: number,
  userId: number | null,
  invoiceId: number,
): Promise<number> {
  const inv = await trx
    .selectFrom('invoices')
    .selectAll()
    .where('id', '=', invoiceId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();
  if (!inv) throw notFound('Invoice not found.');
  if (inv.journal_entry_id) return inv.journal_entry_id;

  const acc = await accountIds(trx, orgId);
  const p = toPaiseFromSql;

  // Typed up front so the conditional pushes below are not narrowed to the
  // shape of the first element.
  const lines: DraftLine[] = [
    { accountId: requireAccount(acc, CODE.AR), debit: p(inv.total), contactId: inv.customer_id },
    { accountId: requireAccount(acc, CODE.SALES), credit: p(inv.subtotal) },
    { accountId: requireAccount(acc, CODE.GST_CGST), credit: p(inv.cgst) },
    { accountId: requireAccount(acc, CODE.GST_SGST), credit: p(inv.sgst) },
    { accountId: requireAccount(acc, CODE.GST_IGST), credit: p(inv.igst) },
    { accountId: requireAccount(acc, CODE.SHIPPING_INCOME), credit: p(inv.shipping_charge) },
    { accountId: requireAccount(acc, CODE.TCS_PAYABLE), credit: p(inv.tcs) },
  ];

  // Rounding is signed: a total rounded up is income, rounded down an expense.
  const roundOff = p(inv.round_off);
  if (roundOff > 0) lines.push({ accountId: requireAccount(acc, CODE.ROUNDING), credit: roundOff });
  else if (roundOff < 0) lines.push({ accountId: requireAccount(acc, CODE.ROUNDING), debit: -roundOff });

  const adjustment = p(inv.adjustment);
  if (adjustment > 0) lines.push({ accountId: requireAccount(acc, CODE.OTHER_INCOME), credit: adjustment });
  else if (adjustment < 0) lines.push({ accountId: requireAccount(acc, CODE.DISCOUNT_ALLOWED), debit: -adjustment });

  const entry = await postEntry(trx, {
    orgId,
    branchId: inv.branch_id,
    date: inv.invoice_date,
    memo: `Invoice ${inv.number}`,
    sourceType: 'invoice',
    sourceId: invoiceId,
    userId,
    module: 'sales',
    lines,
  });

  await trx
    .updateTable('invoices')
    .set({ journal_entry_id: entry.id, status: inv.status === 'draft' ? 'approved' : inv.status })
    .where('id', '=', invoiceId)
    .execute();

  // Now that it is issued, a B2B invoice needs an IRN to be legally valid.
  const customerIsRegistered = await trx
    .selectFrom('contacts').select('gst_treatment')
    .where('id', '=', inv.customer_id).executeTakeFirst();
  const branchGstin = await trx
    .selectFrom('branches').select('gstin').where('id', '=', inv.branch_id).executeTakeFirst();

  if (branchGstin?.gstin && customerIsRegistered?.gst_treatment === 'registered') {
    await trx
      .updateTable('einvoices')
      .set({ status: 'pending' })
      .where('invoice_id', '=', invoiceId)
      .where('status', '=', 'not_applicable')
      .execute();
  }

  return entry.id;
}

/**
 * Void an invoice.
 *
 * Never a delete. GST law requires the number to remain accounted for — a gap
 * in the series is a question at assessment — so the invoice stays, marked
 * void, and its journal entry is reversed rather than removed.
 */
export async function voidInvoice(
  trx: Trx,
  orgId: number,
  userId: number | null,
  invoiceId: number,
  reason?: string,
): Promise<void> {
  const inv = await trx
    .selectFrom('invoices')
    .select(['id', 'number', 'status', 'journal_entry_id', 'amount_paid'])
    .where('id', '=', invoiceId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();
  if (!inv) throw notFound('Invoice not found.');
  if (inv.status === 'void') throw new ApiError(409, 'That invoice is already void.', 'conflict');

  if (toPaiseFromSql(inv.amount_paid) > 0) {
    throw new ApiError(
      409,
      `Invoice ${inv.number} has payments against it. Remove them first, or raise a credit note instead — ` +
        'voiding it would leave the receipt pointing at nothing.',
      'has_payments',
    );
  }

  if (inv.journal_entry_id) {
    await reverseEntry(trx, orgId, inv.journal_entry_id, {
      memo: `Void of invoice ${inv.number}${reason ? ` — ${reason}` : ''}`,
      userId,
      module: 'sales',
    });
  }

  await trx
    .updateTable('invoices')
    .set({ status: 'void', voided_at: new Date() })
    .where('id', '=', invoiceId)
    .execute();

  // A voided invoice is no longer reportable. Leaving it pending would keep it
  // on the compliance queue for an IRN it must never be given.
  await trx
    .updateTable('einvoices')
    .set({ status: 'cancelled', cancelled_at: new Date(), cancel_reason: reason ?? 'Invoice voided' })
    .where('invoice_id', '=', invoiceId)
    .where('status', 'in', ['pending', 'failed'])
    .execute();
}

/** Mark an approved invoice as sent. Posts it first if it was still a draft. */
export async function markInvoiceSent(
  trx: Trx,
  orgId: number,
  userId: number | null,
  invoiceId: number,
): Promise<void> {
  const inv = await trx
    .selectFrom('invoices')
    .select(['id', 'status', 'journal_entry_id'])
    .where('id', '=', invoiceId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();
  if (!inv) throw notFound('Invoice not found.');
  if (inv.status === 'void') throw badRequest('A void invoice cannot be sent.');

  if (!inv.journal_entry_id) await postInvoice(trx, orgId, userId, invoiceId);

  await trx.updateTable('invoices').set({ status: 'sent' }).where('id', '=', invoiceId).execute();
}
