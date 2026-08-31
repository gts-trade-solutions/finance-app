import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// Purchase services: bills and expenses.
//
// The buy side carries three obligations the sell side does not, and each one
// changes the journal entry rather than just a field on the document:
//
//   * Input tax credit. GST paid on a purchase is normally an asset — money the
//     government owes back. But credit on some things is blocked outright under
//     Section 17(5), and on those the tax is not an asset at all; it becomes
//     part of what the thing cost. Claiming it anyway is an assessment finding.
//
//   * Reverse charge. On certain supplies the buyer owes the GST instead of the
//     seller. The bill then posts both sides — a liability for the tax we owe,
//     and the credit we can claim against it — so the two net to nothing in
//     cash terms while both appear in the return, which is what the law wants.
//
//   * TDS. Tax deducted at source is withheld from the vendor and paid to the
//     government under a section code. The vendor is credited the full amount
//     and paid less; the difference is a liability, not a discount.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'kysely';
import type { Trx } from '../db';
import type { Paise, SupplyType } from '../../types';
import { computeLineTax, sumTax, totalTaxPaise } from '../../tax/gst';
import { computeTds } from '../../tax/tds';
import { toPaiseFromSql, toSqlFromPaise } from '../money-sql';
import { allocateOrgNumber, postEntry, reverseEntry, type DraftLine } from '../ledger/posting';
import { CODE, accountIds, requireAccount } from '../ledger/chart-of-accounts';
import { ApiError, badRequest, notFound } from '../http';
import { fyLabelFor } from './sales';

export interface BillLineInput {
  itemId?: number | null;
  accountId?: number | null;
  description?: string | null;
  hsnSac?: string | null;
  qty: number;
  uqc?: string | null;
  /** Omit to use the item's purchase price. Required when there is no item. */
  ratePaise?: Paise;
  discountPct?: number;
  gstRatePct?: number;
  itcEligibility?: 'eligible' | 'ineligible' | 'capital_goods';
}

export interface CreateBillInput {
  branchId: number;
  vendorId: number;
  vendorInvoiceNo: string;
  date: string;
  dueDate: string;
  lines: BillLineInput[];
  isRcm?: boolean;
  tdsSectionOverride?: string | null;
  notes?: string | null;
  sourcePoId?: number | null;
  status?: 'draft' | 'open';
}

/**
 * What this vendor has been billed so far this financial year.
 *
 * TDS sections have annual thresholds — 194C is ₹1,00,000 across the year, not
 * per bill — so the deduction on today's bill depends on everything already
 * billed. Computing it from one invoice in isolation under-deducts, and the
 * shortfall is recovered from us with interest, not from the vendor.
 */
export async function vendorFyTaxable(
  trx: Trx,
  orgId: number,
  vendorId: number,
  onDate: string,
): Promise<Paise> {
  const fyStartYear = Number(onDate.slice(0, 4)) - (Number(onDate.slice(5, 7)) < 4 ? 1 : 0);
  const from = `${fyStartYear}-04-01`;
  const to = `${fyStartYear + 1}-03-31`;

  const { rows } = await sql<{ total: string }>`
    SELECT COALESCE(SUM(subtotal), 0) AS total
    FROM bills
    WHERE org_id = ${orgId} AND vendor_id = ${vendorId}
      AND status <> 'void' AND bill_date BETWEEN ${from} AND ${to}
  `.execute(trx);

  return toPaiseFromSql(rows[0]?.total ?? '0');
}

export async function createBill(
  trx: Trx,
  orgId: number,
  userId: number | null,
  input: CreateBillInput,
): Promise<{ id: number; internalNo: string; totalPaise: Paise; journalEntryId: number | null }> {
  if (!input.lines.length) throw badRequest('A bill needs at least one line.');

  const branch = await trx
    .selectFrom('branches').select(['id', 'state_code'])
    .where('id', '=', input.branchId).where('org_id', '=', orgId).executeTakeFirst();
  if (!branch) throw notFound('That branch does not exist.');

  const vendor = await trx
    .selectFrom('contacts')
    .select(['id', 'display_name', 'state_code', 'gst_treatment', 'pan', 'tds_section'])
    .where('id', '=', input.vendorId).where('org_id', '=', orgId).executeTakeFirst();
  if (!vendor) throw notFound('That vendor does not exist.');

  // A composition dealer cannot charge GST, so there is no tax on the bill and
  // nothing to claim — treating it as taxable would invent a credit.
  const isComposition = vendor.gst_treatment === 'registered_composition';
  const supplyType: SupplyType = isComposition
    ? 'nil_or_exempt'
    : vendor.state_code === branch.state_code
      ? 'intra'
      : 'inter';

  const itemIds = input.lines.map((l) => l.itemId).filter((x): x is number => !!x);
  const items = itemIds.length
    ? await trx
        .selectFrom('items')
        .select(['id', 'name', 'hsn_sac', 'uqc', 'gst_rate_pct', 'purchase_price', 'purchase_account_id'])
        .where('org_id', '=', orgId).where('id', 'in', itemIds).execute()
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const computed = input.lines.map((l, idx) => {
    const item = l.itemId ? itemById.get(l.itemId) : undefined;
    if (l.itemId && !item) throw badRequest(`Line ${idx + 1} refers to an item that does not exist.`);
    if (l.qty <= 0) throw badRequest(`Line ${idx + 1} needs a quantity above zero.`);

    const ratePaise = l.ratePaise ?? (item ? toPaiseFromSql(item.purchase_price) : undefined);
    if (ratePaise === undefined) {
      throw badRequest(`Line ${idx + 1} needs a rate — there is no item to take one from.`);
    }

    const gstRatePct = isComposition ? 0 : (l.gstRatePct ?? Number(item?.gst_rate_pct ?? 18));
    const { taxable, tax, total } = computeLineTax({
      ratePaise,
      qty: l.qty,
      discountPct: l.discountPct ?? 0,
      gstRatePct,
      supplyType,
    });

    return {
      itemId: l.itemId ?? null,
      accountId: l.accountId ?? item?.purchase_account_id ?? null,
      description: l.description ?? item?.name ?? 'Purchase',
      hsnSac: l.hsnSac ?? item?.hsn_sac ?? null,
      qty: l.qty,
      uqc: l.uqc ?? item?.uqc ?? 'NOS',
      ratePaise,
      discountPct: l.discountPct ?? 0,
      gstRatePct,
      taxable,
      tax,
      total,
      itcEligibility: l.itcEligibility ?? 'eligible',
    };
  });

  const tax = sumTax(computed.map((c) => c.tax));
  const subtotal = tax.taxablePaise;

  const sectionCode = input.tdsSectionOverride ?? vendor.tds_section ?? undefined;
  const tds = computeTds({
    sectionCode: sectionCode ?? undefined,
    // No PAN doubles the rate, or 20%, whichever is higher — Section 206AA.
    hasPan: !!vendor.pan,
    billTaxable: subtotal,
    fyPaidSoFar: await vendorFyTaxable(trx, orgId, input.vendorId, input.date),
  });

  // Under reverse charge the supplier does not charge tax, so the payable is
  // the taxable value alone; we account for the GST separately.
  const grossPayable = subtotal + (input.isRcm ? 0 : totalTaxPaise(tax));
  const totalPayable = grossPayable - tds.tdsPaise;

  // Our own reference for the vendor's bill, unique across the organisation
  // (uq_bill_internal). The vendor's own number is theirs and may repeat.
  const internalNo = await allocateOrgNumber(trx, orgId, 'BILL', fyLabelFor(input.date), 'BILL');

  const inserted = await trx
    .insertInto('bills')
    .values({
      org_id: orgId,
      branch_id: input.branchId,
      internal_no: internalNo,
      vendor_invoice_no: input.vendorInvoiceNo,
      vendor_id: input.vendorId,
      bill_date: input.date,
      due_date: input.dueDate,
      place_of_supply: branch.state_code,
      supply_type: supplyType,
      status: input.status ?? 'open',
      is_rcm: input.isRcm ? 1 : 0,
      subtotal: toSqlFromPaise(subtotal),
      cgst: toSqlFromPaise(tax.cgstPaise),
      sgst: toSqlFromPaise(tax.sgstPaise),
      igst: toSqlFromPaise(tax.igstPaise),
      cess: toSqlFromPaise(tax.cessPaise),
      tds_amount: toSqlFromPaise(tds.tdsPaise),
      tds_section: tds.applies ? (sectionCode ?? null) : null,
      round_off: toSqlFromPaise(0),
      total: toSqlFromPaise(totalPayable),
      amount_paid: toSqlFromPaise(0),
      notes: input.notes ?? null,
      source_po_id: input.sourcePoId ?? null,
      created_by_user_id: userId,
    })
    .executeTakeFirstOrThrow();
  const billId = Number(inserted.insertId);

  await trx
    .insertInto('bill_lines')
    .values(
      computed.map((c, i) => ({
        org_id: orgId,
        bill_id: billId,
        line_no: i + 1,
        item_id: c.itemId,
        account_id: c.accountId,
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
        itc_eligibility: c.itcEligibility,
      })),
    )
    .execute();

  let journalEntryId: number | null = null;
  if ((input.status ?? 'open') !== 'draft') {
    journalEntryId = await postBill(trx, orgId, userId, billId);
  }

  return { id: billId, internalNo, totalPaise: totalPayable, journalEntryId };
}

/** Build and post the bill's journal entry. */
export async function postBill(
  trx: Trx,
  orgId: number,
  userId: number | null,
  billId: number,
): Promise<number> {
  const bill = await trx
    .selectFrom('bills').selectAll()
    .where('id', '=', billId).where('org_id', '=', orgId).executeTakeFirst();
  if (!bill) throw notFound('Bill not found.');
  if (bill.journal_entry_id) return bill.journal_entry_id;

  const lines = await trx
    .selectFrom('bill_lines').selectAll().where('bill_id', '=', billId).orderBy('line_no').execute();

  const acc = await accountIds(trx, orgId);
  const p = toPaiseFromSql;
  const isRcm = !!bill.is_rcm;
  const draft: DraftLine[] = [];

  for (const l of lines) {
    const expenseAccount = l.account_id ?? requireAccount(acc, CODE.PURCHASES);
    const lineTax = p(l.cgst) + p(l.sgst) + p(l.igst) + p(l.cess);

    if (l.itc_eligibility === 'eligible' && lineTax > 0 && !isRcm) {
      // Tax is recoverable, so it is an asset and stays out of the cost.
      draft.push({ accountId: expenseAccount, debit: p(l.taxable), description: l.description });
      if (p(l.cgst)) draft.push({ accountId: requireAccount(acc, CODE.ITC_CGST), debit: p(l.cgst) });
      if (p(l.sgst)) draft.push({ accountId: requireAccount(acc, CODE.ITC_SGST), debit: p(l.sgst) });
      if (p(l.igst)) draft.push({ accountId: requireAccount(acc, CODE.ITC_IGST), debit: p(l.igst) });
    } else {
      // Blocked credit, composition purchase, or reverse charge: the tax is not
      // recoverable here, so it is part of what the purchase cost.
      draft.push({
        accountId: expenseAccount,
        debit: p(l.taxable) + (isRcm ? 0 : lineTax),
        description: l.description,
      });
    }
  }

  const tdsPaise = p(bill.tds_amount);
  if (tdsPaise > 0) {
    draft.push({
      accountId: requireAccount(acc, CODE.TDS_PAYABLE),
      credit: tdsPaise,
      description: `TDS ${bill.tds_section ?? ''} withheld`.trim(),
    });
  }

  draft.push({
    accountId: requireAccount(acc, CODE.AP),
    credit: p(bill.total),
    contactId: bill.vendor_id,
    description: `${bill.internal_no} — ${bill.vendor_invoice_no}`,
  });

  // Reverse charge posts both halves: the liability we now owe, and the credit
  // we may claim against it. Net cash effect nil; both appear in the return.
  if (isRcm) {
    const pairs: [string, string, Paise][] = [
      [CODE.ITC_CGST, CODE.GST_CGST, p(bill.cgst)],
      [CODE.ITC_SGST, CODE.GST_SGST, p(bill.sgst)],
      [CODE.ITC_IGST, CODE.GST_IGST, p(bill.igst)],
    ];
    for (const [itcCode, outCode, amount] of pairs) {
      if (amount <= 0) continue;
      draft.push({ accountId: requireAccount(acc, itcCode), debit: amount, description: 'Reverse charge — input credit' });
      draft.push({ accountId: requireAccount(acc, outCode), credit: amount, description: 'Reverse charge — tax payable' });
    }
  }

  const entry = await postEntry(trx, {
    orgId,
    branchId: bill.branch_id,
    date: bill.bill_date,
    memo: `Bill ${bill.internal_no} (${bill.vendor_invoice_no})`,
    sourceType: 'bill',
    sourceId: billId,
    userId,
    module: 'purchases',
    lines: draft,
  });

  await trx
    .updateTable('bills')
    .set({ journal_entry_id: entry.id, status: bill.status === 'draft' ? 'open' : bill.status })
    .where('id', '=', billId)
    .execute();

  return entry.id;
}

export async function voidBill(
  trx: Trx,
  orgId: number,
  userId: number | null,
  billId: number,
  reason?: string,
): Promise<void> {
  const bill = await trx
    .selectFrom('bills').select(['id', 'internal_no', 'status', 'journal_entry_id', 'amount_paid'])
    .where('id', '=', billId).where('org_id', '=', orgId).executeTakeFirst();
  if (!bill) throw notFound('Bill not found.');
  if (bill.status === 'void') throw new ApiError(409, 'That bill is already void.', 'conflict');
  if (toPaiseFromSql(bill.amount_paid) > 0) {
    throw new ApiError(
      409,
      `Bill ${bill.internal_no} has payments against it. Remove them first, or raise a vendor credit — ` +
        'voiding it would leave the payment pointing at nothing.',
      'has_payments',
    );
  }

  if (bill.journal_entry_id) {
    await reverseEntry(trx, orgId, bill.journal_entry_id, {
      memo: `Void of bill ${bill.internal_no}${reason ? ` — ${reason}` : ''}`,
      userId,
      module: 'purchases',
    });
  }

  await trx
    .updateTable('bills').set({ status: 'void', voided_at: new Date() })
    .where('id', '=', billId).execute();
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export interface CreateExpenseInput {
  branchId: number;
  date: string;
  accountId: number;
  paidThroughBankAccountId: number;
  amountPaise: Paise;
  gstRatePct?: number;
  vendorId?: number | null;
  itcEligibility?: 'eligible' | 'ineligible' | 'capital_goods';
  isBillable?: boolean;
  billableCustomerId?: number | null;
  reference?: string | null;
  notes?: string | null;
}

/**
 * An expense is money already spent, with no vendor bill to settle later.
 *
 *   Dr Expense account   what it cost
 *   Dr Input GST         if the credit is claimable
 *     Cr Bank or card    the money that left
 *
 * There is no payable in between, which is the whole difference from a bill.
 */
export async function createExpense(
  trx: Trx,
  orgId: number,
  userId: number | null,
  input: CreateExpenseInput,
): Promise<{ id: number; number: string; totalPaise: Paise; journalEntryId: number }> {
  if (input.amountPaise <= 0) throw badRequest('An expense needs an amount above zero.');

  const bank = await trx
    .selectFrom('bank_accounts').select(['id', 'name', 'ledger_account_id'])
    .where('id', '=', input.paidThroughBankAccountId).where('org_id', '=', orgId).executeTakeFirst();
  if (!bank) throw notFound('That account does not exist.');

  const expenseAccount = await trx
    .selectFrom('accounts').select(['id', 'name'])
    .where('id', '=', input.accountId).where('org_id', '=', orgId).executeTakeFirst();
  if (!expenseAccount) throw notFound('That expense account does not exist.');

  const rate = input.gstRatePct ?? 0;
  // The amount entered is what was actually paid, so any GST inside it is
  // extracted rather than added — a ₹1,180 fuel bill at 18% is ₹1,000 of fuel.
  const taxable = rate > 0 ? Math.round((input.amountPaise * 100) / (100 + rate)) : input.amountPaise;
  const taxTotal = input.amountPaise - taxable;

  const branch = await trx
    .selectFrom('branches').select(['state_code'])
    .where('id', '=', input.branchId).where('org_id', '=', orgId).executeTakeFirst();
  if (!branch) throw notFound('That branch does not exist.');

  // Expenses are paid where we are, so the tax splits between centre and state.
  const half = Math.round(taxTotal / 2);
  const cgst = half;
  const sgst = taxTotal - half;

  const number = await allocateOrgNumber(trx, orgId, 'EXP', fyLabelFor(input.date), 'EXP');

  const eligible = (input.itcEligibility ?? 'eligible') === 'eligible';

  const inserted = await trx
    .insertInto('expenses')
    .values({
      org_id: orgId,
      branch_id: input.branchId,
      number,
      expense_date: input.date,
      account_id: input.accountId,
      vendor_id: input.vendorId ?? null,
      paid_through_bank_account_id: input.paidThroughBankAccountId,
      amount: toSqlFromPaise(taxable),
      gst_rate_pct: rate,
      cgst: toSqlFromPaise(eligible ? cgst : 0),
      sgst: toSqlFromPaise(eligible ? sgst : 0),
      igst: toSqlFromPaise(0),
      total: toSqlFromPaise(input.amountPaise),
      itc_eligibility: input.itcEligibility ?? 'eligible',
      is_billable: input.isBillable ? 1 : 0,
      billable_customer_id: input.billableCustomerId ?? null,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      status: 'recorded',
      created_by_user_id: userId,
    })
    .executeTakeFirstOrThrow();
  const expenseId = Number(inserted.insertId);

  const acc = await accountIds(trx, orgId);
  const draft: DraftLine[] = [];

  if (eligible && taxTotal > 0) {
    draft.push({ accountId: input.accountId, debit: taxable, description: input.notes ?? expenseAccount.name });
    if (cgst) draft.push({ accountId: requireAccount(acc, CODE.ITC_CGST), debit: cgst });
    if (sgst) draft.push({ accountId: requireAccount(acc, CODE.ITC_SGST), debit: sgst });
  } else {
    // Credit not claimable, so the tax is part of the cost.
    draft.push({
      accountId: input.accountId,
      debit: input.amountPaise,
      description: input.notes ?? expenseAccount.name,
    });
  }

  draft.push({
    accountId: bank.ledger_account_id,
    credit: input.amountPaise,
    contactId: input.vendorId ?? null,
    description: `Paid from ${bank.name}`,
  });

  const entry = await postEntry(trx, {
    orgId,
    branchId: input.branchId,
    date: input.date,
    memo: `Expense ${number} — ${expenseAccount.name}`,
    sourceType: 'expense',
    sourceId: expenseId,
    userId,
    module: 'purchases',
    lines: draft,
  });

  await trx
    .updateTable('expenses').set({ journal_entry_id: entry.id })
    .where('id', '=', expenseId).execute();

  return { id: expenseId, number, totalPaise: input.amountPaise, journalEntryId: entry.id };
}
