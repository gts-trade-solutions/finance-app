// ─────────────────────────────────────────────────────────────────────────────
// Sales services — invoices, payments received, credit notes, estimates,
// sales orders, challans, retainers. Every financial action posts a balanced
// journal entry through the posting engine. These signatures are the contract
// for the future real backend.
// ─────────────────────────────────────────────────────────────────────────────

import { getState, setState } from '../store';
import { buildEntry, buildReversal, genId, type DraftLine } from '../ledger/posting';
import { allocateNumber, type DocType } from '../series';
import {
  computeLineTax, resolveSupplyType, sumTax, totalTaxPaise,
} from '../tax/gst';
import { roundToRupee, sumPaise } from '../money';
import { ACC } from '../mock/seed/accounts';
import { FY_SHORT } from '../mock/seed/org';
import { logAudit } from './audit';
import type {
  CreditNote, DeliveryChallan, DocLine, Estimate, Invoice, Payment,
  PaymentAllocation, PaymentMode, RetainerInvoice, SalesOrder, SupplyType,
} from '../types';

export interface LineInput {
  itemId: string | null;
  description?: string;
  qty: number;
  ratePaise: number;
  discountPct?: number;
  gstRatePct?: number; // defaults from item
  hsnSac?: string;
  uqc?: string;
}

/** Build frozen DocLines for a given supply type (shared by all sales docs). */
export function buildDocLines(lines: LineInput[], supplyType: SupplyType): DocLine[] {
  const s = getState();
  return lines
    .filter((l) => l.qty > 0 && l.ratePaise >= 0)
    .map((l) => {
      const item = l.itemId ? s.items.find((i) => i.id === l.itemId) : undefined;
      const gstRatePct = l.gstRatePct ?? item?.gstRatePct ?? 18;
      const { tax, total } = computeLineTax({
        ratePaise: l.ratePaise,
        qty: l.qty,
        discountPct: l.discountPct ?? 0,
        gstRatePct,
        supplyType,
      });
      return {
        id: genId('ln'),
        itemId: l.itemId,
        description: l.description ?? item?.name ?? 'Item',
        hsnSac: l.hsnSac ?? item?.hsnSac ?? '',
        qty: l.qty,
        uqc: l.uqc ?? item?.uqc ?? 'NOS',
        ratePaise: l.ratePaise,
        discountPct: l.discountPct ?? 0,
        gstRatePct,
        tax,
        totalPaise: total,
      };
    });
}

function nextNumber(docType: DocType, branchId: string): string {
  const s = getState();
  const { number, nextState } = allocateNumber(s.series, branchId, docType, FY_SHORT);
  setState({ series: nextState });
  return number;
}

function nextEntryNo(): number {
  const n = getState().nextEntryNo;
  setState({ nextEntryNo: n + 1 });
  return n;
}

function currentUserId(): string {
  return getState().session?.userId ?? 'system';
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export interface CreateInvoiceInput {
  branchId: string;
  customerId: string;
  date: string;
  dueDate: string;
  lines: LineInput[];
  placeOfSupply?: string; // defaults to customer state
  exportWithTax?: boolean;
  notes?: string;
  terms?: string;
  salespersonId?: string;
  status?: 'draft' | 'approved';
  sourceDocId?: string;
  // ── Zoho-parity header fields
  number?: string; // override the auto-allocated series number
  orderNumber?: string;
  subject?: string;
  paymentTerms?: string;
  shippingChargePaise?: number;
  adjustmentPaise?: number;
  adjustmentLabel?: string;
  tcsPaise?: number;
  attachmentCount?: number;
}

export function createInvoice(input: CreateInvoiceInput): Invoice {
  const s = getState();
  const branch = s.branches.find((b) => b.id === input.branchId)!;
  const customer = s.contacts.find((c) => c.id === input.customerId)!;
  const placeOfSupply = input.placeOfSupply ?? customer.stateCode;
  const supplyType = resolveSupplyType({
    branchStateCode: branch.stateCode,
    placeOfSupply,
    customerTreatment: customer.gstTreatment,
    exportWithTax: input.exportWithTax,
  });

  const lines = buildDocLines(input.lines, supplyType);
  const tax = sumTax(lines.map((l) => l.tax));

  // Shipping and adjustment sit outside the line tax, as they do in Zoho.
  const shipping = input.shippingChargePaise ?? 0;
  const adjustment = input.adjustmentPaise ?? 0;
  const tcs = input.tcsPaise ?? 0;
  const gross = tax.taxablePaise + totalTaxPaise(tax) + shipping + adjustment + tcs;
  const { rounded, roundOff } = roundToRupee(gross);

  // The series number is only consumed when we don't take an explicit override,
  // so a user-edited invoice number never burns a slot in the sequence.
  const number = input.number?.trim() || nextNumber('INV', input.branchId);

  const invoice: Invoice = {
    id: genId('inv'),
    number,
    branchId: input.branchId,
    customerId: input.customerId,
    date: input.date,
    dueDate: input.dueDate,
    placeOfSupply,
    supplyType,
    status: input.status ?? 'draft',
    lines,
    subtotalPaise: tax.taxablePaise,
    docDiscountPaise: 0,
    tax,
    tcsPaise: tcs,
    roundOffPaise: roundOff,
    totalPaise: rounded,
    amountPaidPaise: 0,
    notes: input.notes,
    terms: input.terms,
    salespersonId: input.salespersonId,
    orderNumber: input.orderNumber,
    subject: input.subject,
    paymentTerms: input.paymentTerms,
    shippingChargePaise: shipping,
    adjustmentPaise: adjustment,
    adjustmentLabel: input.adjustmentLabel,
    attachmentCount: input.attachmentCount,
    einvoice: {
      status:
        getState().org?.aatoAbove5Cr && customer.gstin ? 'pending' : 'not_applicable',
      deadline: undefined,
    },
    sourceDocId: input.sourceDocId,
    createdAt: new Date().toISOString(),
  };

  setState({ invoices: [invoice, ...getState().invoices] });
  logAudit('create', 'invoice', invoice.id, invoice.number, `Invoice for ${customer.displayName} — ₹${(invoice.totalPaise / 100).toLocaleString('en-IN')}`);

  if (invoice.status === 'approved') postInvoice(invoice.id);
  return invoice;
}

/** Approve a draft: this is the moment the ledger entry is written. */
export function postInvoice(invoiceId: string): void {
  const s = getState();
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv || inv.journalEntryId) return;
  const customer = s.contacts.find((c) => c.id === inv.customerId)!;

  const draft: DraftLine[] = [
    {
      accountId: ACC.AR,
      debit: inv.totalPaise,
      contactId: inv.customerId,
      branchId: inv.branchId,
      description: `${inv.number} — ${customer.displayName}`,
    },
  ];
  // Income per line (item's sale account)
  for (const l of inv.lines) {
    const item = l.itemId ? s.items.find((i) => i.id === l.itemId) : undefined;
    draft.push({
      accountId: item?.saleAccountId ?? ACC.SALES,
      credit: l.tax.taxablePaise,
      branchId: inv.branchId,
      description: l.description,
    });
  }
  // Freight billed to the customer is income, not a reduction of cost.
  if (inv.shippingChargePaise > 0) {
    draft.push({
      accountId: ACC.SHIPPING_INCOME,
      credit: inv.shippingChargePaise,
      branchId: inv.branchId,
      description: 'Shipping & packing charges',
    });
  }
  // A manual adjustment can go either way — a surcharge or a goodwill discount.
  if (inv.adjustmentPaise > 0) {
    draft.push({ accountId: ACC.OTHER_INCOME, credit: inv.adjustmentPaise, description: inv.adjustmentLabel ?? 'Adjustment' });
  } else if (inv.adjustmentPaise < 0) {
    draft.push({ accountId: ACC.OTHER_INCOME, debit: -inv.adjustmentPaise, description: inv.adjustmentLabel ?? 'Adjustment' });
  }
  if (inv.tax.cgstPaise) draft.push({ accountId: ACC.GST_CGST, credit: inv.tax.cgstPaise });
  if (inv.tax.sgstPaise) draft.push({ accountId: ACC.GST_SGST, credit: inv.tax.sgstPaise });
  if (inv.tax.igstPaise) draft.push({ accountId: ACC.GST_IGST, credit: inv.tax.igstPaise });
  // TCS is collected from the buyer and owed onward to the government.
  if (inv.tcsPaise > 0) draft.push({ accountId: ACC.TCS_PAYABLE, credit: inv.tcsPaise });
  if (inv.roundOffPaise > 0) draft.push({ accountId: ACC.ROUNDING, credit: inv.roundOffPaise });
  if (inv.roundOffPaise < 0) draft.push({ accountId: ACC.ROUNDING, debit: -inv.roundOffPaise });

  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date: inv.date,
    sourceType: 'invoice',
    sourceId: inv.id,
    memo: `Invoice ${inv.number} — ${customer.displayName}`,
    lines: draft,
    createdBy: currentUserId(),
  });

  setState({
    entries: [...getState().entries, entry],
    invoices: getState().invoices.map((i) =>
      i.id === inv.id
        ? { ...i, status: i.status === 'draft' ? 'approved' : i.status, journalEntryId: entry.id }
        : i,
    ),
  });
  logAudit('approve', 'invoice', inv.id, inv.number, 'Approved & posted to ledger');
}

export function markInvoiceSent(invoiceId: string): void {
  const inv = getState().invoices.find((i) => i.id === invoiceId);
  if (!inv) return;
  setState({
    invoices: getState().invoices.map((i) =>
      i.id === invoiceId && i.status === 'approved' ? { ...i, status: 'sent' } : i,
    ),
  });
  logAudit('send', 'invoice', invoiceId, inv.number, 'Emailed to customer (simulated)');
}

export function voidInvoice(invoiceId: string, reason: string): void {
  const s = getState();
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv || inv.status === 'void') return;
  if (inv.amountPaidPaise > 0) throw new Error('Cannot void an invoice with payments applied');
  let entries = s.entries;
  if (inv.journalEntryId) {
    const original = s.entries.find((e) => e.id === inv.journalEntryId);
    if (original) {
      const reversal = buildReversal(original, {
        entryNo: nextEntryNo(),
        date: inv.date,
        memo: `VOID ${inv.number}: ${reason}`,
        createdBy: currentUserId(),
      });
      entries = [...getState().entries, reversal];
    }
  }
  setState({
    entries,
    invoices: getState().invoices.map((i) => (i.id === invoiceId ? { ...i, status: 'void' } : i)),
  });
  logAudit('void', 'invoice', inv.id, inv.number, `Voided — ${reason}. Reversal entry posted; original retained.`);
}

// ── Payments received ────────────────────────────────────────────────────────

export interface ReceivePaymentInput {
  customerId: string;
  date: string;
  mode: PaymentMode;
  bankAccountId: string; // BankAccount id (maps to its ledger account)
  amountPaise: number; // cash actually received
  tdsPaise?: number; // TDS the customer deducted
  bankChargesPaise?: number;
  reference?: string;
  allocations: PaymentAllocation[]; // gross amounts applied to invoices
}

export function receivePayment(input: ReceivePaymentInput): Payment {
  const s = getState();
  const customer = s.contacts.find((c) => c.id === input.customerId)!;
  const bank = s.bankAccounts.find((b) => b.id === input.bankAccountId)!;
  const tds = input.tdsPaise ?? 0;
  const charges = input.bankChargesPaise ?? 0;
  const allocated = sumPaise(input.allocations.map((a) => a.amountPaise));
  const gross = input.amountPaise + tds + charges;
  const unapplied = gross - allocated;
  if (unapplied < 0) throw new Error('Allocations exceed payment amount');

  const payment: Payment = {
    id: genId('pay'),
    number: nextNumber('PAY', s.activeBranchId || s.branches[0].id),
    kind: 'received',
    contactId: input.customerId,
    date: input.date,
    mode: input.mode,
    amountPaise: input.amountPaise,
    bankAccountId: input.bankAccountId,
    reference: input.reference ?? '',
    tdsPaise: tds,
    bankChargesPaise: charges,
    allocations: input.allocations,
    unappliedPaise: unapplied,
    status: 'cleared',
    createdAt: new Date().toISOString(),
  };

  const draft: DraftLine[] = [
    { accountId: bank.ledgerAccountId, debit: input.amountPaise, description: `Receipt ${payment.number}` },
  ];
  if (tds > 0) draft.push({ accountId: ACC.TDS_RECEIVABLE, debit: tds, contactId: customer.id, description: 'TDS deducted by customer' });
  if (charges > 0) draft.push({ accountId: ACC.BANK_CHARGES, debit: charges });
  draft.push({ accountId: ACC.AR, credit: gross, contactId: customer.id, description: `Payment from ${customer.displayName}` });

  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date: input.date,
    sourceType: 'payment_received',
    sourceId: payment.id,
    memo: `Payment ${payment.number} from ${customer.displayName}`,
    lines: draft,
    createdBy: currentUserId(),
  });

  // Apply allocations to invoices
  const invoices = getState().invoices.map((inv) => {
    const alloc = input.allocations.find((a) => a.targetType === 'invoice' && a.targetId === inv.id);
    if (!alloc) return inv;
    const paid = inv.amountPaidPaise + alloc.amountPaise;
    const status = paid >= inv.totalPaise ? 'paid' : 'partially_paid';
    return { ...inv, amountPaidPaise: paid, status: status as Invoice['status'] };
  });

  setState({
    payments: [{ ...payment, journalEntryId: entry.id }, ...getState().payments],
    entries: [...getState().entries, entry],
    invoices,
  });
  logAudit('create', 'payment', payment.id, payment.number, `₹${(gross / 100).toLocaleString('en-IN')} from ${customer.displayName}${unapplied > 0 ? ` (₹${(unapplied / 100).toLocaleString('en-IN')} on account)` : ''}`);
  return payment;
}

// ── Credit notes ─────────────────────────────────────────────────────────────

export interface CreateCreditNoteInput {
  branchId: string;
  customerId: string;
  date: string;
  reason: string;
  againstInvoiceId: string | null;
  lines: LineInput[];
}

export function createCreditNote(input: CreateCreditNoteInput): CreditNote {
  const s = getState();
  const branch = s.branches.find((b) => b.id === input.branchId)!;
  const customer = s.contacts.find((c) => c.id === input.customerId)!;
  const supplyType = resolveSupplyType({
    branchStateCode: branch.stateCode,
    placeOfSupply: customer.stateCode,
    customerTreatment: customer.gstTreatment,
  });
  const lines = buildDocLines(input.lines, supplyType);
  const tax = sumTax(lines.map((l) => l.tax));
  const total = tax.taxablePaise + totalTaxPaise(tax);

  const cn: CreditNote = {
    id: genId('cn'),
    number: nextNumber('CN', input.branchId),
    branchId: input.branchId,
    customerId: input.customerId,
    date: input.date,
    reason: input.reason,
    againstInvoiceId: input.againstInvoiceId,
    status: 'open',
    lines,
    tax,
    totalPaise: total,
    appliedPaise: 0,
  };

  const draft: DraftLine[] = [];
  for (const l of lines) {
    const item = l.itemId ? s.items.find((i) => i.id === l.itemId) : undefined;
    draft.push({ accountId: item?.saleAccountId ?? ACC.SALES, debit: l.tax.taxablePaise, description: l.description });
  }
  if (tax.cgstPaise) draft.push({ accountId: ACC.GST_CGST, debit: tax.cgstPaise });
  if (tax.sgstPaise) draft.push({ accountId: ACC.GST_SGST, debit: tax.sgstPaise });
  if (tax.igstPaise) draft.push({ accountId: ACC.GST_IGST, debit: tax.igstPaise });
  draft.push({ accountId: ACC.AR, credit: total, contactId: customer.id, description: `Credit note ${cn.number}` });

  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date: input.date,
    sourceType: 'credit_note',
    sourceId: cn.id,
    memo: `Credit Note ${cn.number} — ${customer.displayName} (${input.reason})`,
    lines: draft,
    createdBy: currentUserId(),
  });

  setState({
    creditNotes: [{ ...cn, journalEntryId: entry.id }, ...getState().creditNotes],
    entries: [...getState().entries, entry],
  });
  logAudit('create', 'credit_note', cn.id, cn.number, `${input.reason} — ₹${(total / 100).toLocaleString('en-IN')}`);
  return cn;
}

// ── Estimates → Sales Orders → Challans ──────────────────────────────────────

export function createEstimate(input: {
  branchId: string; customerId: string; date: string; expiryDate: string; lines: LineInput[]; notes?: string;
}): Estimate {
  const s = getState();
  const branch = s.branches.find((b) => b.id === input.branchId)!;
  const customer = s.contacts.find((c) => c.id === input.customerId)!;
  const supplyType = resolveSupplyType({
    branchStateCode: branch.stateCode,
    placeOfSupply: customer.stateCode,
    customerTreatment: customer.gstTreatment,
  });
  const lines = buildDocLines(input.lines, supplyType);
  const tax = sumTax(lines.map((l) => l.tax));
  const est: Estimate = {
    id: genId('est'),
    number: nextNumber('EST', input.branchId),
    branchId: input.branchId,
    customerId: input.customerId,
    date: input.date,
    expiryDate: input.expiryDate,
    status: 'draft',
    lines,
    tax,
    totalPaise: tax.taxablePaise + totalTaxPaise(tax),
    notes: input.notes,
  };
  setState({ estimates: [est, ...s.estimates] });
  logAudit('create', 'estimate', est.id, est.number, `Estimate for ${customer.displayName}`);
  return est;
}

export function setEstimateStatus(id: string, status: Estimate['status']): void {
  setState({
    estimates: getState().estimates.map((e) => (e.id === id ? { ...e, status } : e)),
  });
  const est = getState().estimates.find((e) => e.id === id);
  if (est) logAudit('update', 'estimate', id, est.number, `Status → ${status}`);
}

export function convertEstimateToSO(estimateId: string): SalesOrder {
  const s = getState();
  const est = s.estimates.find((e) => e.id === estimateId)!;
  const so: SalesOrder = {
    id: genId('so'),
    number: nextNumber('SO', est.branchId),
    branchId: est.branchId,
    customerId: est.customerId,
    date: est.date,
    status: 'open',
    lines: est.lines,
    tax: est.tax,
    totalPaise: est.totalPaise,
    invoicedPaise: 0,
    sourceEstimateId: est.id,
  };
  setState({
    salesOrders: [so, ...s.salesOrders],
    estimates: s.estimates.map((e) => (e.id === estimateId ? { ...e, status: 'converted', convertedToId: so.id } : e)),
  });
  logAudit('create', 'sales_order', so.id, so.number, `Converted from ${est.number}`);
  return so;
}

export function convertSOToInvoice(soId: string, dueDate: string): Invoice {
  const s = getState();
  const so = s.salesOrders.find((x) => x.id === soId)!;
  const inv = createInvoice({
    branchId: so.branchId,
    customerId: so.customerId,
    date: new Date().toISOString().slice(0, 10),
    dueDate,
    lines: so.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      qty: l.qty,
      ratePaise: l.ratePaise,
      discountPct: l.discountPct,
      gstRatePct: l.gstRatePct,
    })),
    status: 'approved',
    sourceDocId: so.id,
  });
  setState({
    salesOrders: getState().salesOrders.map((x) =>
      x.id === soId ? { ...x, status: 'invoiced', invoicedPaise: x.totalPaise } : x,
    ),
  });
  return inv;
}

export function createChallan(input: {
  branchId: string; customerId: string; date: string;
  challanType: DeliveryChallan['challanType']; lines: LineInput[];
}): DeliveryChallan {
  const s = getState();
  const lines = buildDocLines(input.lines, 'nil_or_exempt'); // challans carry no tax
  const dc: DeliveryChallan = {
    id: genId('dc'),
    number: nextNumber('DC', input.branchId),
    branchId: input.branchId,
    customerId: input.customerId,
    date: input.date,
    challanType: input.challanType,
    status: 'open',
    lines,
    totalPaise: sumPaise(lines.map((l) => l.totalPaise)),
  };
  setState({ challans: [dc, ...s.challans] });
  logAudit('create', 'challan', dc.id, dc.number, `Delivery challan (${input.challanType})`);
  return dc;
}

// ── Retainers (advances held as liability) ───────────────────────────────────

export function createRetainer(input: {
  branchId: string; customerId: string; date: string; description: string; amountPaise: number;
}): RetainerInvoice {
  const s = getState();
  const ret: RetainerInvoice = {
    id: genId('ret'),
    number: nextNumber('RET', input.branchId),
    branchId: input.branchId,
    customerId: input.customerId,
    date: input.date,
    status: 'sent',
    description: input.description,
    amountPaise: input.amountPaise,
    appliedPaise: 0,
  };
  setState({ retainers: [ret, ...s.retainers] });
  const customer = s.contacts.find((c) => c.id === input.customerId);
  logAudit('create', 'retainer', ret.id, ret.number, `Retainer for ${customer?.displayName}`);
  return ret;
}

/** Customer pays the retainer: cash in, liability up. NOT income. */
export function receiveRetainerPayment(retainerId: string, bankAccountId: string, date: string): void {
  const s = getState();
  const ret = s.retainers.find((r) => r.id === retainerId)!;
  const bank = s.bankAccounts.find((b) => b.id === bankAccountId)!;
  const customer = s.contacts.find((c) => c.id === ret.customerId)!;
  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date,
    sourceType: 'retainer',
    sourceId: ret.id,
    memo: `Retainer ${ret.number} received — ${customer.displayName}`,
    lines: [
      { accountId: bank.ledgerAccountId, debit: ret.amountPaise },
      { accountId: ACC.UNEARNED, credit: ret.amountPaise, contactId: customer.id, description: 'Advance held as liability' },
    ],
    createdBy: currentUserId(),
  });
  setState({
    entries: [...s.entries, entry],
    retainers: s.retainers.map((r) => (r.id === retainerId ? { ...r, status: 'paid', journalEntryId: entry.id } : r)),
  });
  logAudit('update', 'retainer', ret.id, ret.number, 'Payment received — held as Unearned Revenue');
}
