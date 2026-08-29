import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// The standard Indian chart of accounts a new organisation starts with.
//
// System accounts are referenced by CODE rather than by row id. Codes are
// stable, meaningful to an accountant, and survive a database rebuild; an
// auto-increment id survives none of those things. Every posting service looks
// up what it needs through `accountIds()` once per transaction.
//
// The numbering follows the convention every Indian bookkeeper already reads:
// 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx–6xxx expenses.
// ─────────────────────────────────────────────────────────────────────────────

import type { Executor, Trx } from '../db';

/** Codes the posting engine depends on. Renaming one is a migration. */
export const CODE = {
  // Assets
  AR: '1100',
  BANK_DEFAULT: '1210',
  PAYMENT_CLEARING: '1250',
  CASH: '1290',
  ITC_CGST: '1310',
  ITC_SGST: '1320',
  ITC_IGST: '1330',
  TDS_RECEIVABLE: '1400',
  INVENTORY: '1500',
  FIXED_ASSETS: '1600',
  // Liabilities
  AP: '2100',
  GST_CGST: '2210',
  GST_SGST: '2220',
  GST_IGST: '2230',
  RCM_PAYABLE: '2240',
  TDS_PAYABLE: '2300',
  TCS_PAYABLE: '2310',
  UNEARNED: '2400',
  CREDIT_CARD: '2500',
  // Equity
  CAPITAL: '3100',
  RETAINED: '3200',
  OPENING_BALANCE_EQUITY: '3300',
  // Income
  SALES: '4100',
  SERVICE_INCOME: '4200',
  SHIPPING_INCOME: '4300',
  DISCOUNT_ALLOWED: '4400',
  OTHER_INCOME: '4900',
  // Expenses
  COGS: '5100',
  PURCHASES: '5200',
  FREIGHT: '5300',
  RENT: '6100',
  SALARIES: '6200',
  PROFESSIONAL: '6300',
  COMMISSION: '6350',
  UTILITIES: '6400',
  INTERNET: '6450',
  FUEL: '6500',
  OFFICE: '6600',
  MARKETING: '6700',
  BANK_CHARGES: '6800',
  ROUNDING: '6900',
  WRITE_OFF: '6950',
} as const;

export type AccountCode = (typeof CODE)[keyof typeof CODE];
type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

interface SeedAccount {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  /** System accounts cannot be deleted or retyped: postings depend on them. */
  system?: boolean;
  description?: string;
}

export const STANDARD_ACCOUNTS: SeedAccount[] = [
  // ── Assets ────────────────────────────────────────────────────────────────
  { code: CODE.AR, name: 'Accounts Receivable', type: 'asset', subtype: 'receivable', system: true, description: 'What customers owe us' },
  { code: CODE.BANK_DEFAULT, name: 'Bank Account', type: 'asset', subtype: 'bank', system: true },
  { code: CODE.PAYMENT_CLEARING, name: 'Payment Clearing Account', type: 'asset', subtype: 'bank', system: true, description: 'Collected but not yet in a bank account' },
  { code: CODE.CASH, name: 'Cash in Hand', type: 'asset', subtype: 'cash', system: true },
  { code: CODE.ITC_CGST, name: 'Input CGST (ITC)', type: 'asset', subtype: 'tax', system: true, description: 'Central GST paid on purchases, claimable against output tax' },
  { code: CODE.ITC_SGST, name: 'Input SGST (ITC)', type: 'asset', subtype: 'tax', system: true },
  { code: CODE.ITC_IGST, name: 'Input IGST (ITC)', type: 'asset', subtype: 'tax', system: true },
  { code: CODE.TDS_RECEIVABLE, name: 'TDS Receivable', type: 'asset', subtype: 'tax', system: true, description: 'Tax customers deducted from our invoices, recoverable from the government' },
  { code: CODE.INVENTORY, name: 'Inventory Asset', type: 'asset', subtype: 'stock', system: true },
  { code: CODE.FIXED_ASSETS, name: 'Furniture & Equipment', type: 'asset', subtype: 'fixed_asset' },

  // ── Liabilities ───────────────────────────────────────────────────────────
  { code: CODE.AP, name: 'Accounts Payable', type: 'liability', subtype: 'payable', system: true, description: 'What we owe suppliers' },
  { code: CODE.GST_CGST, name: 'Output CGST Payable', type: 'liability', subtype: 'tax', system: true },
  { code: CODE.GST_SGST, name: 'Output SGST Payable', type: 'liability', subtype: 'tax', system: true },
  { code: CODE.GST_IGST, name: 'Output IGST Payable', type: 'liability', subtype: 'tax', system: true },
  { code: CODE.RCM_PAYABLE, name: 'GST Payable under Reverse Charge', type: 'liability', subtype: 'tax', system: true, description: 'GST we owe on purchases where the supplier does not charge it' },
  { code: CODE.TDS_PAYABLE, name: 'TDS Payable', type: 'liability', subtype: 'tax', system: true, description: 'Tax withheld from vendors, owed to the government' },
  { code: CODE.TCS_PAYABLE, name: 'TCS Payable', type: 'liability', subtype: 'tax', system: true },
  { code: CODE.UNEARNED, name: 'Unearned Revenue (Retainers)', type: 'liability', subtype: 'current', system: true, description: 'Advances taken for work not yet done' },
  { code: CODE.CREDIT_CARD, name: 'Credit Card', type: 'liability', subtype: 'credit_card', system: true },

  // ── Equity ────────────────────────────────────────────────────────────────
  { code: CODE.CAPITAL, name: 'Owner’s Capital', type: 'equity', system: true },
  { code: CODE.RETAINED, name: 'Retained Earnings', type: 'equity', system: true },
  { code: CODE.OPENING_BALANCE_EQUITY, name: 'Opening Balance Equity', type: 'equity', system: true, description: 'Holds the other side of opening balances until the books are complete' },

  // ── Income ────────────────────────────────────────────────────────────────
  { code: CODE.SALES, name: 'Sales', type: 'income', system: true },
  { code: CODE.SERVICE_INCOME, name: 'Service Income', type: 'income' },
  { code: CODE.SHIPPING_INCOME, name: 'Shipping & Packing Charges', type: 'income' },
  { code: CODE.DISCOUNT_ALLOWED, name: 'Discount Allowed', type: 'income', description: 'Contra-income: reduces revenue rather than adding an expense' },
  { code: CODE.OTHER_INCOME, name: 'Other Income', type: 'income' },

  // ── Expenses ──────────────────────────────────────────────────────────────
  { code: CODE.COGS, name: 'Cost of Goods Sold', type: 'expense', system: true },
  { code: CODE.PURCHASES, name: 'Purchases – Trading Goods', type: 'expense', system: true },
  { code: CODE.FREIGHT, name: 'Freight & Cartage Inward', type: 'expense' },
  { code: CODE.RENT, name: 'Rent', type: 'expense' },
  { code: CODE.SALARIES, name: 'Salaries & Wages', type: 'expense' },
  { code: CODE.PROFESSIONAL, name: 'Professional & Legal Fees', type: 'expense' },
  { code: CODE.COMMISSION, name: 'Commission & Brokerage', type: 'expense' },
  { code: CODE.UTILITIES, name: 'Electricity & Water', type: 'expense' },
  { code: CODE.INTERNET, name: 'Telephone & Internet', type: 'expense' },
  { code: CODE.FUEL, name: 'Fuel & Vehicle Running', type: 'expense' },
  { code: CODE.OFFICE, name: 'Office Supplies', type: 'expense' },
  { code: CODE.MARKETING, name: 'Advertising & Marketing', type: 'expense' },
  { code: CODE.BANK_CHARGES, name: 'Bank Fees & Charges', type: 'expense', system: true },
  { code: CODE.ROUNDING, name: 'Rounding Off', type: 'expense', system: true, description: 'Absorbs the paisa lost when an invoice total is rounded to the rupee' },
  { code: CODE.WRITE_OFF, name: 'Bad Debts Written Off', type: 'expense', system: true },
];

/** Install the standard chart for a new organisation. Idempotent. */
export async function installChartOfAccounts(trx: Trx, orgId: number): Promise<number> {
  const existing = await trx
    .selectFrom('accounts')
    .select('code')
    .where('org_id', '=', orgId)
    .execute();
  const have = new Set(existing.map((r) => r.code));

  const missing = STANDARD_ACCOUNTS.filter((a) => !have.has(a.code));
  if (missing.length === 0) return 0;

  await trx
    .insertInto('accounts')
    .values(
      missing.map((a) => ({
        org_id: orgId,
        code: a.code,
        name: a.name,
        type: a.type,
        subtype: a.subtype ?? null,
        description: a.description ?? null,
        is_system: a.system ? 1 : 0,
        is_active: 1,
      })),
    )
    .execute();

  return missing.length;
}

/**
 * Resolve every account code to its row id, in one query.
 *
 * Posting services call this once and then index into the result, rather than
 * issuing a lookup per line — a twenty-line bill would otherwise mean twenty
 * round trips inside a transaction that is holding row locks.
 */
export async function accountIds(
  ex: Executor,
  orgId: number,
): Promise<Record<string, number>> {
  const rows = await ex
    .selectFrom('accounts')
    .select(['id', 'code'])
    .where('org_id', '=', orgId)
    .execute();
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}

/** Look one up, failing loudly — a missing system account is not recoverable. */
export function requireAccount(map: Record<string, number>, code: string): number {
  const id = map[code];
  if (!id) {
    throw new Error(
      `Account ${code} is missing from the chart of accounts. ` +
        'It is a system account the posting engine needs; re-run onboarding to restore it.',
    );
  }
  return id;
}
