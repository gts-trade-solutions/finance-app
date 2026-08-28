// ─────────────────────────────────────────────────────────────────────────────
// Seed orchestrator. Builds a realistic book of business by calling the REAL
// services — so every seeded invoice/bill/payment has a genuine balanced
// journal entry, and the Trial Balance ties from the first render.
// ─────────────────────────────────────────────────────────────────────────────

import { getState, setState, EMPTY_COLLECTIONS } from '../../store';
import { SEED_ACCOUNTS, ACC } from './accounts';
import { SEED_BRANCHES, SEED_ORG, SEED_USERS } from './org';
import { SEED_CUSTOMERS, SEED_VENDORS } from './contacts';
import { SEED_ITEMS } from './items';
import { SEED_HSN_CODES } from './hsn';
import { createManualJournal } from '../../services/journal';
import {
  createCreditNote, createEstimate, createInvoice, createRetainer,
  receivePayment, receiveRetainerPayment, markInvoiceSent, createChallan,
  convertEstimateToSO,
} from '../../services/sales';
import { createBill, createExpense, createPurchaseOrder, createVendorCredit, makePayment } from '../../services/purchases';
import { importBankTxns } from '../../services/banking';
import { genId } from '../../ledger/posting';
import type {
  ApiToken, ApprovalRule, BankAccount, BankRule, Cheque, CustomFieldDef,
  Gstr2bEntry, StockMove, Warehouse, WorkflowRule,
} from '../../types';

const R = (rupees: number) => Math.round(rupees * 100);

/** Fixed demo "today" so the dataset always looks the same and ageing is stable. */
export const DEMO_TODAY = '2026-08-07';

function daysAgo(n: number): string {
  const d = new Date(DEMO_TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysAhead(n: number): string {
  const d = new Date(DEMO_TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const BANK_ACCOUNTS: BankAccount[] = [
  { id: 'ba_hdfc', kind: 'bank', name: 'HDFC Bank – Current', bankName: 'HDFC Bank', isPrimary: true, accountLast4: '4412', ifsc: 'HDFC0000123', ledgerAccountId: ACC.BANK_HDFC, openingBalancePaise: R(12_50_000), feedConnected: true },
  { id: 'ba_icici', kind: 'bank', name: 'ICICI Bank – Current', bankName: 'ICICI Bank', accountLast4: '8890', ifsc: 'ICIC0000456', ledgerAccountId: ACC.BANK_ICICI, openingBalancePaise: R(4_20_000), feedConnected: false },
  { id: 'ba_cash', kind: 'cash', name: 'Cash in Hand', ledgerAccountId: ACC.CASH, openingBalancePaise: R(35_000), feedConnected: false },
  { id: 'ba_card', kind: 'card', name: 'HDFC Business Credit Card', bankName: 'HDFC Bank', accountLast4: '7731', ledgerAccountId: ACC.CC_HDFC, openingBalancePaise: 0, feedConnected: true },
  { id: 'ba_clearing', kind: 'clearing', name: 'Payment Clearing Account', ledgerAccountId: ACC.PAYMENT_CLEARING, openingBalancePaise: 0, feedConnected: false },
];

const BANK_RULES: BankRule[] = [
  { id: 'br_fuel', name: 'Fuel purchases → Fuel expense', priority: 1, conditions: [{ field: 'narration', op: 'contains', value: 'BHARAT PETRO' }], actionAccountId: ACC.FUEL, contactId: 'v_bharat', autoConfirm: true, isActive: true },
  { id: 'br_rent', name: 'Monthly rent → Rent', priority: 2, conditions: [{ field: 'narration', op: 'contains', value: 'CITY PROPERTIES' }], actionAccountId: ACC.RENT, contactId: 'v_cityprop', autoConfirm: true, isActive: true },
  { id: 'br_charges', name: 'Bank charges', priority: 3, conditions: [{ field: 'narration', op: 'contains', value: 'CHARGES' }], actionAccountId: ACC.BANK_CHARGES, autoConfirm: true, isActive: true },
  { id: 'br_internet', name: 'Internet bill → Telephone & Internet', priority: 4, conditions: [{ field: 'narration', op: 'contains', value: 'AIRTEL' }], actionAccountId: ACC.INTERNET, autoConfirm: false, isActive: true },
];

const WAREHOUSES: Warehouse[] = [
  { id: 'wh_chennai', name: 'Chennai Main Store', branchId: 'br_chennai' },
  { id: 'wh_blr', name: 'Bengaluru Depot Store', branchId: 'br_bengaluru' },
];

const WORKFLOWS: WorkflowRule[] = [
  { id: 'wf_1', name: 'Thank-you email on payment', module: 'Sales', trigger: 'Payment received', conditionSummary: 'Always', actionSummary: 'Email “Payment received” template to customer', isActive: true },
  { id: 'wf_2', name: 'Escalate 30-day overdue', module: 'Sales', trigger: 'Invoice overdue by 30 days', conditionSummary: 'Balance > ₹25,000', actionSummary: 'Email owner + tag customer “Follow-up”', isActive: true },
  { id: 'wf_3', name: 'Large invoice → notify director', module: 'Sales', trigger: 'Invoice created', conditionSummary: 'Total > ₹2,00,000', actionSummary: 'Notify arun@raceautospares.in', isActive: true },
  { id: 'wf_4', name: 'MSME 45-day alert', module: 'Purchases', trigger: 'Daily at 09:00', conditionSummary: 'MSME bill unpaid ≥ 38 days', actionSummary: 'Email accounts team + dashboard flag', isActive: true },
  { id: 'wf_5', name: 'E-invoice deadline warning', module: 'Compliance', trigger: 'Daily at 08:00', conditionSummary: 'IRN pending & deadline ≤ 7 days', actionSummary: 'Email + dashboard banner', isActive: true },
];

const APPROVALS: ApprovalRule[] = [
  { id: 'ap_1', module: 'Invoices', thresholdPaise: R(2_00_000), approverRole: 'admin', isActive: true },
  { id: 'ap_2', module: 'Credit Notes', thresholdPaise: 0, approverRole: 'accountant', isActive: true },
  { id: 'ap_3', module: 'Vendor Payments', thresholdPaise: R(1_00_000), approverRole: 'admin', isActive: true },
];

const CUSTOM_FIELDS: CustomFieldDef[] = [
  { id: 'cf_1', entity: 'Invoice', label: 'Vehicle Registration No.', fieldType: 'text', showOnPdf: true },
  { id: 'cf_2', entity: 'Invoice', label: 'Job Card No.', fieldType: 'text', showOnPdf: true },
  { id: 'cf_3', entity: 'Customer', label: 'Dealer Tier', fieldType: 'dropdown', options: ['Platinum', 'Gold', 'Silver'], showOnPdf: false },
  { id: 'cf_4', entity: 'Bill', label: 'LR / Docket No.', fieldType: 'text', showOnPdf: false },
];

const API_TOKENS: ApiToken[] = [
  { id: 'tok_1', name: 'Website order sync', tokenPreview: 'fna_live_••••••4f2a', scopes: ['invoices:read', 'invoices:write', 'customers:read'], createdAt: daysAgo(90), lastUsed: daysAgo(1) },
  { id: 'tok_2', name: 'Power BI dashboard', tokenPreview: 'fna_live_••••••9c17', scopes: ['reports:read'], createdAt: daysAgo(45), lastUsed: daysAgo(3) },
];

/** Statement lines: some match seeded payments, some are genuinely unreconciled. */
function bankStatementRows() {
  return [
    { date: daysAgo(2), amountPaise: R(1_18_000), direction: 'in' as const, narration: 'NEFT CR SHARMA TRADERS INV0001', reference: 'N2026080712' },
    { date: daysAgo(3), amountPaise: R(4_500), direction: 'out' as const, narration: 'BHARAT PETRO FUEL GUINDY', reference: 'POS8891' },
    { date: daysAgo(4), amountPaise: R(2_36_000), direction: 'in' as const, narration: 'RTGS CR APEX MOTORS PVT LTD', reference: 'R2026080401' },
    { date: daysAgo(5), amountPaise: R(85_000), direction: 'out' as const, narration: 'CITY PROPERTIES RENT AUG', reference: 'ACH0091' },
    { date: daysAgo(6), amountPaise: R(590), direction: 'out' as const, narration: 'BANK CHARGES NEFT', reference: 'CHG221' },
    { date: daysAgo(7), amountPaise: R(1_770), direction: 'out' as const, narration: 'AIRTEL BROADBAND BILL', reference: 'BP7781' },
    { date: daysAgo(8), amountPaise: R(3_54_000), direction: 'out' as const, narration: 'NEFT DR BOSCH AUTOMOTIVE DIST', reference: 'N2026073101' },
    { date: daysAgo(9), amountPaise: R(47_200), direction: 'in' as const, narration: 'UPI CR MARINA CAR CARE', reference: 'UPI9981231' },
    { date: daysAgo(11), amountPaise: R(12_500), direction: 'out' as const, narration: 'SWIFT LOGISTICS FREIGHT', reference: 'N2026072801' },
    { date: daysAgo(12), amountPaise: R(94_400), direction: 'in' as const, narration: 'NEFT CR SPEEDWELL GARAGES', reference: 'N2026072702' },
    { date: daysAgo(14), amountPaise: R(28_000), direction: 'out' as const, narration: 'ATM CASH WDL GUINDY', reference: 'ATM6612' },
    { date: daysAgo(16), amountPaise: R(1_65_200), direction: 'in' as const, narration: 'NEFT CR NATIONAL SPARES CO', reference: 'N2026072201' },
  ];
}

function gstr2bSeed(): Gstr2bEntry[] {
  return [
    { id: genId('2b'), vendorGstin: '29AAACB2222N1Z5', vendorName: 'Bosch Automotive Distributors', invoiceNo: 'BOS/26-27/1187', invoiceDate: daysAgo(20), taxablePaise: R(2_75_000), taxPaise: R(77_000), matchStatus: 'matched' },
    { id: genId('2b'), vendorGstin: '33AAACM4444Q1Z9', vendorName: 'MRF Tyres Regional Depot', invoiceNo: 'MRF/8842', invoiceDate: daysAgo(18), taxablePaise: R(1_38_000), taxPaise: R(38_640), matchStatus: 'matched' },
    { id: genId('2b'), vendorGstin: '07AAACL3333P1Z1', vendorName: 'Lumax Lighting Co', invoiceNo: 'LMX-4471', invoiceDate: daysAgo(15), taxablePaise: R(93_000), taxPaise: R(26_040), matchStatus: 'mismatch', note: 'Books show ₹92,000 taxable — ₹1,000 difference' },
    { id: genId('2b'), vendorGstin: '27AAACG5555R1Z7', vendorName: 'Gabriel Shockers Ltd', invoiceNo: 'GS/26/0912', invoiceDate: daysAgo(12), taxablePaise: R(63_000), taxPaise: R(17_640), matchStatus: 'missing_in_books', note: 'Vendor filed but we have no bill — ITC available, book it' },
    { id: genId('2b'), vendorGstin: '33AAACS6666S1Z5', vendorName: 'Sundaram Fasteners Agency', invoiceNo: 'SF/2026/331', invoiceDate: daysAgo(25), taxablePaise: R(42_000), taxPaise: R(11_760), matchStatus: 'missing_in_2b', note: 'We booked it but vendor has NOT filed — ITC at risk, chase vendor' },
  ];
}

function cheques(): Cheque[] {
  return [
    { id: genId('chq'), kind: 'received', contactId: 'c_hosur', chequeNo: '447120', bankName: 'Canara Bank', amountPaise: R(64_000), isPdc: true, maturityDate: daysAhead(9), status: 'in_hand' },
    { id: genId('chq'), kind: 'received', contactId: 'c_trichy', chequeNo: '883301', bankName: 'IOB', amountPaise: R(38_500), isPdc: false, maturityDate: daysAgo(2), status: 'deposited' },
    { id: genId('chq'), kind: 'issued', contactId: 'v_gabriel', chequeNo: '221904', bankName: 'HDFC Bank', amountPaise: R(1_20_000), isPdc: true, maturityDate: daysAhead(14), status: 'in_hand' },
    { id: genId('chq'), kind: 'received', contactId: 'c_bluehill', chequeNo: '556677', bankName: 'SBI', amountPaise: R(22_000), isPdc: false, maturityDate: daysAgo(6), status: 'bounced' },
  ];
}

/**
 * Wipe and rebuild the whole demo dataset.
 * `rich` adds extra history for a denser walkthrough.
 */
export function seedDatabase(opts: { rich?: boolean; keepSession?: boolean } = {}): void {
  const prevSession = opts.keepSession ? getState().session : null;

  // 1. Reset to empty, then install masters
  setState({
    ...EMPTY_COLLECTIONS,
    session: prevSession,
    org: SEED_ORG,
    branches: SEED_BRANCHES,
    users: SEED_USERS,
    activeBranchId: SEED_BRANCHES[0].id,
    accounts: SEED_ACCOUNTS,
    contacts: [...SEED_CUSTOMERS, ...SEED_VENDORS],
    items: SEED_ITEMS,
    hsnCodes: SEED_HSN_CODES,
    bankAccounts: BANK_ACCOUNTS,
    bankRules: BANK_RULES,
    warehouses: WAREHOUSES,
    workflows: WORKFLOWS,
    approvals: APPROVALS,
    customFields: CUSTOM_FIELDS,
    apiTokens: API_TOKENS,
    webhooks: [
      { id: 'wh_1', url: 'https://hooks.raceautospares.in/invoice-paid', events: ['invoice.paid', 'payment.received'], isActive: true },
      { id: 'wh_2', url: 'https://crm.raceautospares.in/api/hooks/books', events: ['invoice.created', 'customer.created'], isActive: false },
    ],
    gstr2b: gstr2bSeed(),
    cheques: cheques(),
    seeded: true,
  });

  // 2. Opening balances — one balanced journal establishing the starting position
  createManualJournal({
    date: '2026-04-01',
    memo: 'Opening balances as at 01-Apr-2026',
    sourceType: 'opening',
    lines: [
      { accountId: ACC.BANK_HDFC, debit: R(12_50_000), description: 'HDFC opening' },
      { accountId: ACC.BANK_ICICI, debit: R(4_20_000), description: 'ICICI opening' },
      { accountId: ACC.CASH, debit: R(35_000), description: 'Cash opening' },
      { accountId: ACC.INVENTORY, debit: R(18_60_000), description: 'Opening stock' },
      { accountId: ACC.FIXED_ASSETS, debit: R(6_40_000), description: 'Furniture & equipment' },
      { accountId: ACC.CAPITAL, credit: R(35_00_000), description: 'Owner capital' },
      { accountId: ACC.RETAINED, credit: R(7_05_000), description: 'Retained earnings b/f' },
    ],
  });

  // 3. Sales history — mixed states so GST behaviour is visible everywhere
  const sales: {
    customerId: string; daysAgo: number; terms: number;
    lines: { itemId: string; qty: number; rate?: number }[];
    pay?: 'full' | 'part' | 'none'; tds?: boolean;
  }[] = [
    // ── Prior quarter (April–June 2026). Without a few months of history the
    // trend charts have nothing to trend and every "vs previous period"
    // comparison reads "no comparable prior period", which makes a working
    // dashboard look broken. Two of these are left unpaid on purpose so the
    // 60+ ageing bucket has something real in it.
    { customerId: 'c_sharma', daysAgo: 128, terms: 30, lines: [{ itemId: 'i_tyre', qty: 12 }, { itemId: 'i_fitment', qty: 12 }], pay: 'full' },
    { customerId: 'c_national', daysAgo: 121, terms: 30, lines: [{ itemId: 'i_battery', qty: 14 }], pay: 'full' },
    { customerId: 'c_marina', daysAgo: 114, terms: 15, lines: [{ itemId: 'i_engineoil', qty: 30 }, { itemId: 'i_oilfilter', qty: 40 }], pay: 'full' },
    { customerId: 'c_deccan', daysAgo: 110, terms: 30, lines: [{ itemId: 'i_radiator', qty: 3 }, { itemId: 'i_coolant', qty: 20 }], pay: 'none' },
    { customerId: 'c_apex', daysAgo: 103, terms: 30, lines: [{ itemId: 'i_clutch', qty: 15 }], pay: 'full', tds: true },
    { customerId: 'c_velocity', daysAgo: 96, terms: 30, lines: [{ itemId: 'i_shocker', qty: 22 }, { itemId: 'i_beltkit', qty: 8 }], pay: 'full' },
    { customerId: 'c_hosur', daysAgo: 88, terms: 30, lines: [{ itemId: 'i_alternator', qty: 5 }], pay: 'none' },
    { customerId: 'c_speedwell', daysAgo: 81, terms: 30, lines: [{ itemId: 'i_headlamp', qty: 10 }, { itemId: 'i_fitment', qty: 10 }], pay: 'full' },
    { customerId: 'c_kochi', daysAgo: 74, terms: 30, lines: [{ itemId: 'i_sparkplug', qty: 24 }, { itemId: 'i_cabinfilter', qty: 30 }], pay: 'full' },
    { customerId: 'c_orbit', daysAgo: 66, terms: 30, lines: [{ itemId: 'i_mirrror', qty: 8 }, { itemId: 'i_hornset', qty: 16 }], pay: 'full', tds: true },
    { customerId: 'c_bluehill', daysAgo: 59, terms: 30, lines: [{ itemId: 'i_tyre', qty: 18 }], pay: 'full' },
    { customerId: 'c_trichy', daysAgo: 52, terms: 30, lines: [{ itemId: 'i_brakepad', qty: 30 }, { itemId: 'i_greasekit', qty: 25 }], pay: 'part' },
    { customerId: 'c_national', daysAgo: 45, terms: 30, lines: [{ itemId: 'i_wiper', qty: 35 }, { itemId: 'i_airfilter', qty: 28 }], pay: 'full' },
    { customerId: 'c_ridez', daysAgo: 40, terms: 0, lines: [{ itemId: 'i_engineoil', qty: 6 }, { itemId: 'i_fitment', qty: 3 }], pay: 'full' },
    { customerId: 'c_sharma', daysAgo: 34, terms: 30, lines: [{ itemId: 'i_brakepad', qty: 20 }, { itemId: 'i_oilfilter', qty: 30 }], pay: 'full' },
    { customerId: 'c_apex', daysAgo: 30, terms: 30, lines: [{ itemId: 'i_battery', qty: 25 }, { itemId: 'i_fitment', qty: 25 }], pay: 'full', tds: true },
    { customerId: 'c_velocity', daysAgo: 27, terms: 30, lines: [{ itemId: 'i_tyre', qty: 16 }], pay: 'part' },
    { customerId: 'c_speedwell', daysAgo: 24, terms: 30, lines: [{ itemId: 'i_clutch', qty: 8 }, { itemId: 'i_fitment', qty: 8 }], pay: 'full' },
    { customerId: 'c_national', daysAgo: 22, terms: 45, lines: [{ itemId: 'i_headlamp', qty: 12 }, { itemId: 'i_wiper', qty: 40 }], pay: 'full' },
    { customerId: 'c_marina', daysAgo: 20, terms: 15, lines: [{ itemId: 'i_engineoil', qty: 24 }, { itemId: 'i_airfilter', qty: 20 }], pay: 'full' },
    { customerId: 'c_deccan', daysAgo: 18, terms: 30, lines: [{ itemId: 'i_alternator', qty: 6 }], pay: 'none' },
    { customerId: 'c_hosur', daysAgo: 16, terms: 30, lines: [{ itemId: 'i_shocker', qty: 18 }, { itemId: 'i_beltkit', qty: 6 }], pay: 'part' },
    { customerId: 'c_kochi', daysAgo: 14, terms: 30, lines: [{ itemId: 'i_radiator', qty: 4 }, { itemId: 'i_coolant', qty: 30 }], pay: 'none' },
    { customerId: 'c_orbit', daysAgo: 12, terms: 30, lines: [{ itemId: 'i_sparkplug', qty: 30 }, { itemId: 'i_fitment', qty: 15 }], pay: 'none', tds: true },
    { customerId: 'c_sez', daysAgo: 11, terms: 30, lines: [{ itemId: 'i_brakepad', qty: 40 }], pay: 'none' },
    { customerId: 'c_lanka', daysAgo: 10, terms: 45, lines: [{ itemId: 'i_clutch', qty: 25 }], pay: 'none' },
    { customerId: 'c_bluehill', daysAgo: 9, terms: 30, lines: [{ itemId: 'i_engineoil', qty: 12 }, { itemId: 'i_cabinfilter', qty: 18 }], pay: 'none' },
    { customerId: 'c_trichy', daysAgo: 7, terms: 30, lines: [{ itemId: 'i_mirrror', qty: 6 }, { itemId: 'i_hornset', qty: 10 }], pay: 'none' },
    { customerId: 'c_ridez', daysAgo: 6, terms: 0, lines: [{ itemId: 'i_wiper', qty: 2 }, { itemId: 'i_fitment', qty: 1 }], pay: 'full' },
    { customerId: 'c_sharma', daysAgo: 5, terms: 30, lines: [{ itemId: 'i_greasekit', qty: 40 }, { itemId: 'i_oilfilter', qty: 25 }], pay: 'none' },
    { customerId: 'c_apex', daysAgo: 4, terms: 30, lines: [{ itemId: 'i_tyre', qty: 20 }], pay: 'none' },
    { customerId: 'c_velocity', daysAgo: 3, terms: 30, lines: [{ itemId: 'i_battery', qty: 10 }], pay: 'none' },
    { customerId: 'c_marina', daysAgo: 2, terms: 15, lines: [{ itemId: 'i_sparkplug', qty: 12 }], pay: 'none' },
    { customerId: 'c_speedwell', daysAgo: 1, terms: 30, lines: [{ itemId: 'i_airfilter', qty: 25 }, { itemId: 'i_fitment', qty: 10 }], pay: 'none' },
  ];

  const items = SEED_ITEMS;
  for (const sale of sales) {
    const branchId = ['c_apex', 'c_orbit'].includes(sale.customerId) ? 'br_bengaluru' : 'br_chennai';
    const inv = createInvoice({
      branchId,
      customerId: sale.customerId,
      date: daysAgo(sale.daysAgo),
      dueDate: daysAgo(sale.daysAgo - sale.terms),
      status: 'approved',
      lines: sale.lines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        ratePaise: l.rate ? R(l.rate) : items.find((i) => i.id === l.itemId)!.salePricePaise,
      })),
      terms: 'Goods once sold will not be taken back. Interest @18% p.a. on overdue amounts.',
    });
    markInvoiceSent(inv.id);

    if (sale.pay && sale.pay !== 'none') {
      const gross = sale.pay === 'full' ? inv.totalPaise : Math.round(inv.totalPaise * 0.4);
      const tds = sale.tds ? Math.round(inv.subtotalPaise * 0.02) : 0;
      receivePayment({
        customerId: sale.customerId,
        date: daysAgo(Math.max(0, sale.daysAgo - 12)),
        mode: gross > R(50_000) ? 'neft' : 'upi',
        bankAccountId: 'ba_hdfc',
        amountPaise: gross - tds,
        tdsPaise: tds,
        reference: `Ref ${inv.number}`,
        allocations: [{ targetType: 'invoice', targetId: inv.id, amountPaise: gross }],
      });
    }
  }

  // Credit note against the first invoice (damaged goods returned)
  const firstInv = getState().invoices[getState().invoices.length - 1];
  if (firstInv) {
    createCreditNote({
      branchId: firstInv.branchId,
      customerId: firstInv.customerId,
      date: daysAgo(28),
      reason: 'Goods returned — damaged in transit',
      againstInvoiceId: firstInv.id,
      lines: [{ itemId: 'i_brakepad', qty: 2, ratePaise: items.find((i) => i.id === 'i_brakepad')!.salePricePaise }],
    });
  }

  // Estimate + challan + retainer to show the full sales chain
  createEstimate({
    branchId: 'br_chennai', customerId: 'c_bluehill', date: daysAgo(5), expiryDate: daysAhead(10),
    lines: [{ itemId: 'i_tyre', qty: 24, ratePaise: items.find((i) => i.id === 'i_tyre')!.salePricePaise }],
    notes: 'Fleet tyre replacement — 6 vehicles',
  });
  createEstimate({
    branchId: 'br_chennai', customerId: 'c_trichy', date: daysAgo(2), expiryDate: daysAhead(13),
    lines: [{ itemId: 'i_headlamp', qty: 4, ratePaise: items.find((i) => i.id === 'i_headlamp')!.salePricePaise }],
  });
  createChallan({
    branchId: 'br_chennai', customerId: 'c_speedwell', date: daysAgo(3), challanType: 'job_work',
    lines: [{ itemId: 'i_alternator', qty: 2, ratePaise: items.find((i) => i.id === 'i_alternator')!.purchasePricePaise }],
  });
  const ret = createRetainer({
    branchId: 'br_chennai', customerId: 'c_bluehill', date: daysAgo(8),
    description: 'Annual fleet maintenance retainer — Q2', amountPaise: R(1_50_000),
  });
  receiveRetainerPayment(ret.id, 'ba_hdfc', daysAgo(7));

  // A second retainer, still fully unearned — so the retainer report shows both
  // an advance that has been drawn down and one that has not.
  createRetainer({
    branchId: 'br_chennai', customerId: 'c_speedwell', date: daysAgo(4),
    description: 'Workshop AMC advance — H2', amountPaise: R(60_000),
  });

  // Accept the first quote and turn it into a sales order, then part-invoice it.
  // That gives the Sales Order Details report a live backlog to show rather
  // than an empty table.
  {
    const quote = getState().estimates[0];
    if (quote) {
      setState((st) => ({
        estimates: st.estimates.map((e) => (e.id === quote.id ? { ...e, status: 'accepted' as const } : e)),
      }));
      const so = convertEstimateToSO(quote.id);
      setState((st) => ({
        salesOrders: st.salesOrders.map((o) =>
          o.id === so.id
            ? { ...o, status: 'partially_invoiced' as const, invoicedPaise: Math.round(o.totalPaise * 0.4), expectedShipDate: daysAhead(6) }
            : o,
        ),
      }));
    }
  }

  // One customer credit refunded in cash rather than applied, and one supplier
  // credit refunded back to us — the two directions the refund report covers.
  {
    const cn = getState().creditNotes[0];
    if (cn) {
      setState((st) => ({
        creditNotes: st.creditNotes.map((c) => (c.id === cn.id ? { ...c, status: 'refunded' as const } : c)),
      }));
    }
  }

  // 4. Purchases — includes MSME vendors, a composition vendor, RCM, TDS
  const purchases: {
    vendorId: string; daysAgo: number; terms: number; vendorNo: string;
    lines: { itemId?: string; qty: number; rate: number; desc?: string; account?: string }[];
    rcm?: boolean; pay?: boolean;
  }[] = [
    { vendorId: 'v_bosch', daysAgo: 20, terms: 30, vendorNo: 'BOS/26-27/1187', lines: [{ itemId: 'i_sparkplug', qty: 100, rate: 1290 }, { itemId: 'i_alternator', qty: 18, rate: 6800 }], pay: true },
    { vendorId: 'v_mrf', daysAgo: 18, terms: 30, vendorNo: 'MRF/8842', lines: [{ itemId: 'i_tyre', qty: 30, rate: 4600 }], pay: true },
    { vendorId: 'v_lumax', daysAgo: 15, terms: 45, vendorNo: 'LMX-4471', lines: [{ itemId: 'i_headlamp', qty: 20, rate: 3400 }, { itemId: 'i_hornset', qty: 40, rate: 520 }] },
    { vendorId: 'v_gabriel', daysAgo: 12, terms: 30, vendorNo: 'GS/26/0912', lines: [{ itemId: 'i_shocker', qty: 42, rate: 1500 }] },
    { vendorId: 'v_sundaram', daysAgo: 41, terms: 30, vendorNo: 'SF/2026/331', lines: [{ itemId: 'i_beltkit', qty: 12, rate: 2500 }] }, // MSME, ageing past 40 days → tracker
    { vendorId: 'v_menon', daysAgo: 10, terms: 15, vendorNo: 'MA/26-27/044', lines: [{ qty: 1, rate: 45_000, desc: 'Statutory audit & GST advisory — Q1', account: ACC.PROFESSIONAL }] }, // 194J TDS
    { vendorId: 'v_swift', daysAgo: 8, terms: 15, vendorNo: 'SL/2026/2231', lines: [{ qty: 1, rate: 38_000, desc: 'Freight — July consignments', account: ACC.FREIGHT }] }, // 194C TDS
    { vendorId: 'v_kamal', daysAgo: 6, terms: 15, vendorNo: 'KE/771', lines: [{ itemId: 'i_greasekit', qty: 60, rate: 150 }] }, // composition — no GST, no ITC
    { vendorId: 'v_cityprop', daysAgo: 5, terms: 7, vendorNo: 'RENT/AUG/26', lines: [{ qty: 1, rate: 85_000, desc: 'Office & godown rent — August 2026', account: ACC.RENT }], rcm: true }, // unregistered landlord → RCM
    { vendorId: 'v_bosch', daysAgo: 3, terms: 30, vendorNo: 'BOS/26-27/1244', lines: [{ itemId: 'i_clutch', qty: 30, rate: 2250 }] },
  ];

  for (const p of purchases) {
    const bill = createBill({
      branchId: 'br_chennai',
      vendorId: p.vendorId,
      vendorInvoiceNo: p.vendorNo,
      date: daysAgo(p.daysAgo),
      dueDate: daysAgo(p.daysAgo - p.terms),
      isRcm: p.rcm,
      lines: p.lines.map((l) => ({
        itemId: l.itemId ?? null,
        description: l.desc,
        qty: l.qty,
        ratePaise: R(l.rate),
        accountId: l.account,
      })),
    });
    if (p.pay) {
      makePayment({
        vendorId: p.vendorId,
        date: daysAgo(Math.max(0, p.daysAgo - 10)),
        mode: 'neft',
        bankAccountId: 'ba_hdfc',
        reference: `Paid ${bill.internalNo}`,
        allocations: [{ targetType: 'bill', targetId: bill.id, amountPaise: bill.totalPaise }],
      });
    }
  }

  createPurchaseOrder({
    branchId: 'br_chennai', vendorId: 'v_bosch', date: daysAgo(2), expectedDate: daysAhead(12),
    lines: [{ itemId: 'i_battery', qty: 40, ratePaise: R(3950) }, { itemId: 'i_oilfilter', qty: 200, ratePaise: R(155) }],
  });

  // A supplier short-shipped and refunded the difference rather than issuing a
  // credit against the next order — the inward half of the refund report.
  {
    const lumaxBill = getState().bills.find((b) => b.vendorId === 'v_lumax');
    if (lumaxBill) {
      const vc = createVendorCredit({
        branchId: 'br_chennai',
        vendorId: 'v_lumax',
        date: daysAgo(9),
        reason: 'Short shipment — 4 horn sets not delivered',
        againstBillId: lumaxBill.id,
        amountPaise: R(2_454),
      });
      setState((st) => ({
        vendorCredits: st.vendorCredits.map((x) => (x.id === vc.id ? { ...x, status: 'refunded' as const } : x)),
      }));
    }
  }

  // 5. Expenses paid directly
  const expenses = [
    { account: ACC.UTILITIES, amount: 12_400, gst: 18, note: 'EB bill — Guindy godown (Jul)', days: 9, bank: 'ba_hdfc' },
    { account: ACC.INTERNET, amount: 1_500, gst: 18, note: 'Airtel broadband — August', days: 7, bank: 'ba_hdfc' },
    { account: ACC.FUEL, amount: 4_500, gst: 0, note: 'Fuel — delivery van TN09 AB 1234', days: 3, bank: 'ba_card' },
    { account: ACC.OFFICE, amount: 3_200, gst: 18, note: 'Stationery & printer toner', days: 6, bank: 'ba_cash' },
    { account: ACC.MARKETING, amount: 25_000, gst: 18, note: 'Google Ads — August campaign', days: 5, bank: 'ba_card' },
    { account: ACC.SALARIES, amount: 2_85_000, gst: 0, note: 'Staff salaries — July 2026', days: 6, bank: 'ba_hdfc' },
  ];
  for (const e of expenses) {
    createExpense({
      branchId: 'br_chennai',
      date: daysAgo(e.days),
      accountId: e.account,
      paidThroughId: e.bank,
      amountPaise: R(e.amount),
      gstRatePct: e.gst,
      notes: e.note,
      receiptAttached: true,
    });
  }

  // 6. Bank statement lines (some will match seeded payments, some won't)
  importBankTxns('ba_hdfc', bankStatementRows(), 'HDFC-Aug-2026.csv');

  // 7. Stock moves for the inventory module
  const moves: StockMove[] = SEED_ITEMS.filter((i) => i.trackInventory).map((i) => ({
    id: genId('sm'),
    date: '2026-04-01',
    itemId: i.id,
    warehouseId: 'wh_chennai',
    qty: i.openingStockQty ?? 0,
    ratePaise: i.purchasePricePaise,
    sourceType: 'opening',
    sourceId: null,
    note: 'Opening stock',
  }));
  setState({ stockMoves: moves });

  if (opts.rich) {
    // Extra month of history for a denser demo
    for (let k = 0; k < 8; k++) {
      const c = SEED_CUSTOMERS[k % SEED_CUSTOMERS.length];
      const it = SEED_ITEMS[(k * 3) % (SEED_ITEMS.length - 1)];
      createInvoice({
        branchId: 'br_chennai',
        customerId: c.id,
        date: daysAgo(60 + k * 3),
        dueDate: daysAgo(30 + k * 3),
        status: 'approved',
        lines: [{ itemId: it.id, qty: 5 + k, ratePaise: it.salePricePaise }],
      });
    }
  }
}

/** Idempotent: seed only if the store is empty (called by the app shell). */
export function ensureSeeded(): void {
  if (!getState().seeded || getState().accounts.length === 0) {
    seedDatabase({ keepSession: true });
  }
}
