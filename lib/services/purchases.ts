// ─────────────────────────────────────────────────────────────────────────────
// Purchase services — bills (with ITC / RCM / TDS), expenses, POs, vendor
// credits, payments made. Mirrors sales.ts patterns.
// ─────────────────────────────────────────────────────────────────────────────

import { getState, setState } from '../store';
import { buildEntry, buildReversal, genId, type DraftLine } from '../ledger/posting';
import { allocateNumber, type DocType } from '../series';
import { computeLineTax, resolveSupplyType, sumTax, totalTaxPaise } from '../tax/gst';
import { computeTds } from '../tax/tds';
import { sumPaise } from '../money';
import { ACC } from '../mock/seed/accounts';
import { FY_SHORT } from '../mock/seed/org';
import { logAudit } from './audit';
import type {
  Bill, DocLine, Expense, Payment, PaymentAllocation, PaymentMode,
  PurchaseOrder, VendorCredit,
} from '../types';
import type { LineInput } from './sales';

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

/** Gross taxable billed to a vendor this FY (drives TDS threshold logic). */
export function vendorFyTaxable(vendorId: string): number {
  const s = getState();
  return sumPaise(
    s.bills.filter((b) => b.vendorId === vendorId && b.status !== 'void').map((b) => b.subtotalPaise),
  );
}

// ── Bills ────────────────────────────────────────────────────────────────────

export interface CreateBillInput {
  branchId: string;
  vendorId: string;
  vendorInvoiceNo: string;
  date: string;
  dueDate: string;
  lines: (LineInput & {
    accountId?: string; // expense/purchase account; defaults to item's or Purchases
    itcEligibility?: DocLine['itcEligibility'];
  })[];
  isRcm?: boolean;
  tdsSectionOverride?: string; // defaults from vendor mapping
}

export function createBill(input: CreateBillInput): Bill {
  const s = getState();
  const branch = s.branches.find((b) => b.id === input.branchId)!;
  const vendor = s.contacts.find((c) => c.id === input.vendorId)!;

  // Composition vendors charge no GST; their "tax" is zero by law.
  const vendorIsComposition = vendor.gstTreatment === 'registered_composition';
  const supplyType = vendorIsComposition
    ? 'nil_or_exempt'
    : resolveSupplyType({
        branchStateCode: branch.stateCode,
        placeOfSupply: branch.stateCode, // goods received at our branch
        customerTreatment: 'registered',
      }) === 'intra' && vendor.stateCode === branch.stateCode
      ? 'intra'
      : vendor.stateCode === branch.stateCode
        ? 'intra'
        : 'inter';

  const lines: DocLine[] = input.lines.map((l) => {
    const item = l.itemId ? s.items.find((i) => i.id === l.itemId) : undefined;
    const gstRatePct = vendorIsComposition ? 0 : (l.gstRatePct ?? item?.gstRatePct ?? 18);
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
      description: l.description ?? item?.name ?? 'Purchase',
      hsnSac: l.hsnSac ?? item?.hsnSac ?? '',
      qty: l.qty,
      uqc: l.uqc ?? item?.uqc ?? 'NOS',
      ratePaise: l.ratePaise,
      discountPct: l.discountPct ?? 0,
      gstRatePct,
      tax,
      totalPaise: total,
      itcEligibility: l.itcEligibility ?? 'eligible',
    };
  });

  const tax = sumTax(lines.map((l) => l.tax));
  const subtotal = tax.taxablePaise;

  // TDS on the taxable base (per vendor's section, FY accumulator, PAN status)
  const sectionCode = input.tdsSectionOverride ?? vendor.tdsSection;
  const tds = computeTds({
    sectionCode,
    hasPan: !!vendor.pan,
    billTaxable: subtotal,
    fyPaidSoFar: vendorFyTaxable(input.vendorId),
  });

  const grossPayable = subtotal + (input.isRcm ? 0 : totalTaxPaise(tax));
  const totalPayable = grossPayable - tds.tdsPaise;

  const bill: Bill = {
    id: genId('bill'),
    number: input.vendorInvoiceNo,
    internalNo: nextNumber('BILL', input.branchId),
    branchId: input.branchId,
    vendorId: input.vendorId,
    date: input.date,
    dueDate: input.dueDate,
    status: 'open',
    isRcm: input.isRcm ?? false,
    lines,
    subtotalPaise: subtotal,
    tax,
    tdsSection: tds.applies ? sectionCode : undefined,
    tdsPaise: tds.tdsPaise,
    totalPaise: totalPayable,
    amountPaidPaise: 0,
    createdAt: new Date().toISOString(),
  };

  // ── Posting
  const draft: DraftLine[] = [];
  for (const l of lines) {
    const item = l.itemId ? s.items.find((i) => i.id === l.itemId) : undefined;
    const lineInput = input.lines[lines.indexOf(l)];
    const expenseAccount = lineInput.accountId ?? item?.purchaseAccountId ?? ACC.PURCHASES;
    const lineTax = totalTaxPaise(l.tax);
    if (l.itcEligibility === 'eligible' && lineTax > 0 && !input.isRcm) {
      draft.push({ accountId: expenseAccount, debit: l.tax.taxablePaise, description: l.description });
      if (l.tax.cgstPaise) draft.push({ accountId: ACC.ITC_CGST, debit: l.tax.cgstPaise });
      if (l.tax.sgstPaise) draft.push({ accountId: ACC.ITC_SGST, debit: l.tax.sgstPaise });
      if (l.tax.igstPaise) draft.push({ accountId: ACC.ITC_IGST, debit: l.tax.igstPaise });
    } else {
      // Ineligible ITC (or composition/no tax): tax becomes part of the cost
      draft.push({
        accountId: expenseAccount,
        debit: l.tax.taxablePaise + (input.isRcm ? 0 : lineTax),
        description: l.description,
      });
    }
  }
  if (bill.tdsPaise > 0) draft.push({ accountId: ACC.TDS_PAYABLE, credit: bill.tdsPaise, description: tds.reason });
  draft.push({
    accountId: ACC.AP,
    credit: totalPayable,
    contactId: vendor.id,
    description: `${bill.internalNo} — ${vendor.displayName}`,
  });

  // RCM: we owe the GST ourselves and claim it back — post both sides
  if (input.isRcm) {
    const rcmTax = totalTaxPaise(tax);
    if (rcmTax > 0) {
      if (tax.cgstPaise) {
        draft.push({ accountId: ACC.ITC_CGST, debit: tax.cgstPaise, description: 'RCM self-invoice ITC' });
        draft.push({ accountId: ACC.GST_CGST, credit: tax.cgstPaise, description: 'RCM output liability' });
      }
      if (tax.sgstPaise) {
        draft.push({ accountId: ACC.ITC_SGST, debit: tax.sgstPaise });
        draft.push({ accountId: ACC.GST_SGST, credit: tax.sgstPaise });
      }
      if (tax.igstPaise) {
        draft.push({ accountId: ACC.ITC_IGST, debit: tax.igstPaise });
        draft.push({ accountId: ACC.GST_IGST, credit: tax.igstPaise });
      }
    }
  }

  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date: input.date,
    sourceType: 'bill',
    sourceId: bill.id,
    memo: `Bill ${bill.internalNo} (${bill.number}) — ${vendor.displayName}`,
    lines: draft,
    createdBy: currentUserId(),
  });

  setState({
    bills: [{ ...bill, journalEntryId: entry.id }, ...getState().bills],
    entries: [...getState().entries, entry],
  });
  logAudit('create', 'bill', bill.id, bill.internalNo, `${vendor.displayName} — ₹${(grossPayable / 100).toLocaleString('en-IN')}${tds.applies ? ` (TDS ${tds.reason})` : ''}`);
  return bill;
}

export function voidBill(billId: string, reason: string): void {
  const s = getState();
  const bill = s.bills.find((b) => b.id === billId);
  if (!bill || bill.status === 'void') return;
  if (bill.amountPaidPaise > 0) throw new Error('Cannot void a bill with payments applied');
  let entries = s.entries;
  if (bill.journalEntryId) {
    const original = s.entries.find((e) => e.id === bill.journalEntryId);
    if (original) {
      entries = [
        ...entries,
        buildReversal(original, {
          entryNo: nextEntryNo(),
          date: bill.date,
          memo: `VOID ${bill.internalNo}: ${reason}`,
          createdBy: currentUserId(),
        }),
      ];
    }
  }
  setState({
    entries,
    bills: getState().bills.map((b) => (b.id === billId ? { ...b, status: 'void' } : b)),
  });
  logAudit('void', 'bill', bill.id, bill.internalNo, `Voided — ${reason}`);
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export interface CreateExpenseInput {
  branchId: string;
  date: string;
  accountId: string;
  vendorId?: string | null;
  paidThroughId: string; // BankAccount id
  amountPaise: number; // taxable base
  gstRatePct?: number;
  isBillable?: boolean;
  customerId?: string;
  notes: string;
  receiptAttached?: boolean;
}

export function createExpense(input: CreateExpenseInput): Expense {
  const s = getState();
  const paidThrough = s.bankAccounts.find((b) => b.id === input.paidThroughId)!;
  const gstRatePct = input.gstRatePct ?? 0;
  const { tax, total } = computeLineTax({
    ratePaise: input.amountPaise,
    qty: 1,
    discountPct: 0,
    gstRatePct,
    supplyType: 'intra', // demo: local expenses
  });

  const expense: Expense = {
    id: genId('exp'),
    number: nextNumber('EXP', input.branchId),
    branchId: input.branchId,
    date: input.date,
    accountId: input.accountId,
    vendorId: input.vendorId ?? null,
    paidThroughId: input.paidThroughId,
    amountPaise: input.amountPaise,
    gstRatePct,
    tax,
    isBillable: input.isBillable ?? false,
    customerId: input.customerId,
    notes: input.notes,
    receiptAttached: input.receiptAttached ?? false,
    status: 'recorded',
  };

  const draft: DraftLine[] = [
    { accountId: input.accountId, debit: tax.taxablePaise, description: input.notes },
  ];
  if (tax.cgstPaise) draft.push({ accountId: ACC.ITC_CGST, debit: tax.cgstPaise });
  if (tax.sgstPaise) draft.push({ accountId: ACC.ITC_SGST, debit: tax.sgstPaise });
  if (tax.igstPaise) draft.push({ accountId: ACC.ITC_IGST, debit: tax.igstPaise });
  draft.push({ accountId: paidThrough.ledgerAccountId, credit: total });

  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date: input.date,
    sourceType: 'expense',
    sourceId: expense.id,
    memo: `Expense ${expense.number} — ${input.notes}`,
    lines: draft,
    createdBy: currentUserId(),
  });

  setState({
    expenses: [{ ...expense, journalEntryId: entry.id }, ...getState().expenses],
    entries: [...getState().entries, entry],
  });
  logAudit('create', 'expense', expense.id, expense.number, input.notes);
  return expense;
}

// ── Payments made ────────────────────────────────────────────────────────────

export interface MakePaymentInput {
  vendorId: string;
  date: string;
  mode: PaymentMode;
  bankAccountId: string;
  allocations: PaymentAllocation[];
  reference?: string;
}

export function makePayment(input: MakePaymentInput): Payment {
  const s = getState();
  const vendor = s.contacts.find((c) => c.id === input.vendorId)!;
  const bank = s.bankAccounts.find((b) => b.id === input.bankAccountId)!;
  const total = sumPaise(input.allocations.map((a) => a.amountPaise));

  const payment: Payment = {
    id: genId('vpay'),
    number: nextNumber('VPAY', s.activeBranchId || s.branches[0].id),
    kind: 'made',
    contactId: input.vendorId,
    date: input.date,
    mode: input.mode,
    amountPaise: total,
    bankAccountId: input.bankAccountId,
    reference: input.reference ?? '',
    tdsPaise: 0,
    bankChargesPaise: 0,
    allocations: input.allocations,
    unappliedPaise: 0,
    status: 'cleared',
    createdAt: new Date().toISOString(),
  };

  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date: input.date,
    sourceType: 'payment_made',
    sourceId: payment.id,
    memo: `Payment ${payment.number} to ${vendor.displayName}`,
    lines: [
      { accountId: ACC.AP, debit: total, contactId: vendor.id },
      { accountId: bank.ledgerAccountId, credit: total },
    ],
    createdBy: currentUserId(),
  });

  const bills = getState().bills.map((b) => {
    const alloc = input.allocations.find((a) => a.targetType === 'bill' && a.targetId === b.id);
    if (!alloc) return b;
    const paid = b.amountPaidPaise + alloc.amountPaise;
    return { ...b, amountPaidPaise: paid, status: (paid >= b.totalPaise ? 'paid' : 'partially_paid') as Bill['status'] };
  });

  setState({
    payments: [{ ...payment, journalEntryId: entry.id }, ...getState().payments],
    entries: [...getState().entries, entry],
    bills,
  });
  logAudit('create', 'payment', payment.id, payment.number, `₹${(total / 100).toLocaleString('en-IN')} to ${vendor.displayName}`);
  return payment;
}

// ── Purchase orders & vendor credits ─────────────────────────────────────────

export function createPurchaseOrder(input: {
  branchId: string; vendorId: string; date: string; expectedDate?: string; lines: LineInput[];
}): PurchaseOrder {
  const s = getState();
  const lines = input.lines.map((l) => {
    const item = l.itemId ? s.items.find((i) => i.id === l.itemId) : undefined;
    const gstRatePct = l.gstRatePct ?? item?.gstRatePct ?? 18;
    const vendor = s.contacts.find((c) => c.id === input.vendorId)!;
    const branch = s.branches.find((b) => b.id === input.branchId)!;
    const st = vendor.stateCode === branch.stateCode ? 'intra' : 'inter';
    const { tax, total } = computeLineTax({
      ratePaise: l.ratePaise, qty: l.qty, discountPct: l.discountPct ?? 0, gstRatePct, supplyType: st,
    });
    return {
      id: genId('ln'), itemId: l.itemId, description: l.description ?? item?.name ?? 'Item',
      hsnSac: l.hsnSac ?? item?.hsnSac ?? '', qty: l.qty, uqc: l.uqc ?? item?.uqc ?? 'NOS',
      ratePaise: l.ratePaise, discountPct: l.discountPct ?? 0, gstRatePct, tax, totalPaise: total,
    } as DocLine;
  });
  const po: PurchaseOrder = {
    id: genId('po'),
    number: nextNumber('PO', input.branchId),
    branchId: input.branchId,
    vendorId: input.vendorId,
    date: input.date,
    expectedDate: input.expectedDate,
    status: 'issued',
    lines,
    totalPaise: sumPaise(lines.map((l) => l.totalPaise)),
    billedPaise: 0,
  };
  setState({ purchaseOrders: [po, ...s.purchaseOrders] });
  logAudit('create', 'purchase_order', po.id, po.number, `PO to ${s.contacts.find((c) => c.id === input.vendorId)?.displayName}`);
  return po;
}

export function createVendorCredit(input: {
  branchId: string; vendorId: string; date: string; reason: string;
  againstBillId: string | null; amountPaise: number;
}): VendorCredit {
  const s = getState();
  const vendor = s.contacts.find((c) => c.id === input.vendorId)!;
  const vc: VendorCredit = {
    id: genId('vc'),
    number: nextNumber('VC', input.branchId),
    branchId: input.branchId,
    vendorId: input.vendorId,
    date: input.date,
    reason: input.reason,
    againstBillId: input.againstBillId,
    status: 'open',
    totalPaise: input.amountPaise,
    appliedPaise: 0,
  };
  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date: input.date,
    sourceType: 'vendor_credit',
    sourceId: vc.id,
    memo: `Vendor credit ${vc.number} — ${vendor.displayName} (${input.reason})`,
    lines: [
      { accountId: ACC.AP, debit: input.amountPaise, contactId: vendor.id },
      { accountId: ACC.PURCHASES, credit: input.amountPaise, description: input.reason },
    ],
    createdBy: currentUserId(),
  });
  setState({
    vendorCredits: [{ ...vc, journalEntryId: entry.id }, ...s.vendorCredits],
    entries: [...getState().entries, entry],
  });
  logAudit('create', 'vendor_credit', vc.id, vc.number, input.reason);
  return vc;
}
