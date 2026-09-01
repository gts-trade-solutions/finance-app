'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The browser's side of the API.
//
// One place that knows how a request is shaped and how a failure is reported,
// so no component ends up parsing an error body of its own. The session travels
// in an httpOnly cookie, which is why every call sets credentials: 'include'
// and no token is ever held in JavaScript — script that cannot read the cookie
// cannot steal the session.
// ─────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field-level messages from server-side validation, keyed by field name. */
  readonly details?: Record<string, string>;

  constructor(status: number, message: string, code = 'error', details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the caller should send the user back to sign in. */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }
}

interface Options extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Query parameters; undefined and null values are dropped. */
  params?: Record<string, string | number | boolean | null | undefined>;
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const { body, params, headers, ...rest } = options;

  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      ...rest,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // A network failure is not a server error, and saying "something went
    // wrong" would send someone hunting through logs for a dropped wifi signal.
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.', 'offline');
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const b = (parsed ?? {}) as { error?: string; code?: string; details?: Record<string, string> };
    throw new ApiError(
      res.status,
      b.error || `Request failed (${res.status}).`,
      b.code || 'error',
      b.details,
    );
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, params?: Options['params']) => request<T>(path, { method: 'GET', params }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── Typed endpoints ──────────────────────────────────────────────────────────

export interface SessionResponse {
  user: {
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'accountant' | 'sales' | 'staff' | 'viewer';
    branchId: string | null;
    activeBranchId?: string | null;
  };
  org: {
    id: string;
    name: string;
    pan: string | null;
    gstRegistrationType: string;
    aatoAbove5Cr: boolean;
    fiscalYearStartMonth: number;
    baseCurrency: string;
    address: string | null;
    email: string | null;
    phone: string | null;
    onboarded: boolean;
    isDemo: boolean;
  } | null;
  branches: {
    id: string;
    name: string;
    gstin: string | null;
    stateCode: string;
    address: string | null;
    isPrimary: boolean;
  }[];
}

export interface InvoiceListItem {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  status: string;
  supplyType: string;
  supplyKind: string;
  customerId: string;
  customerName: string;
  branchId: string;
  subtotalPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  balancePaise: number;
  einvoice: { status: string; irn: string | null };
}

export interface InvoiceJournalLine {
  lineNo: number;
  accountCode: string;
  accountName: string;
  debitPaise: number;
  creditPaise: number;
  description: string | null;
}

export interface InvoiceDetail {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  status: string;
  supplyType: string;
  supplyKind: string;
  placeOfSupply: string;
  customer: { id: string; name: string; gstin: string | null; address: string | null };
  branch: { id: string; name: string; gstin: string | null };
  orderNumber: string | null;
  subject: string | null;
  paymentTerms: string | null;
  notes: string | null;
  terms: string | null;
  subtotalPaise: number;
  tax: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  tcsPaise: number;
  shippingChargePaise: number;
  adjustmentPaise: number;
  adjustmentLabel: string | null;
  roundOffPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  balancePaise: number;
  lines: {
    id: string;
    itemId: string | null;
    description: string | null;
    hsnSac: string | null;
    qty: number;
    uqc: string | null;
    ratePaise: number;
    discountPct: number;
    gstRatePct: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalPaise: number;
  }[];
  einvoice: { status: string; irn: string | null; ackNo?: string | null; ackDate?: string | null };
  payments: { id: string; number: string; date: string; mode: string; amountPaise: number }[];
  journalEntryId: string | null;
  journalLines: InvoiceJournalLine[];
}

export interface InvoiceListResponse {
  invoices: InvoiceListItem[];
  /** Per-status counts over the same period, ignoring the status filter. */
  statusCounts: Record<string, number>;
  summary: { count: number; totalPaise: number; duePaise: number };
}

export const auth = {
  login: (email: string, password: string) =>
    api.post<{ user: SessionResponse['user'] }>('/api/auth/login', { email, password }),
  logout: () => api.post<{ ok: true }>('/api/auth/logout'),
  me: () => api.get<SessionResponse>('/api/auth/me'),
  register: (input: {
    businessName: string;
    stateCode: string;
    gstin?: string;
    pan?: string;
    name: string;
    email: string;
    phone?: string;
    password: string;
  }) =>
    api.post<{ user: SessionResponse['user']; org: { id: string; name: string } }>(
      '/api/auth/register',
      input,
    ),
  /** One click into the seeded demo book, as one of its four roles. */
  demo: (role: 'admin' | 'accountant' | 'sales' | 'viewer' = 'admin') =>
    api.post<{ user: SessionResponse['user']; org: { id: string; name: string } }>(
      '/api/auth/demo',
      { role },
    ),
};

export const invoices = {
  list: (params?: {
    from?: string; to?: string; status?: string; customerId?: string;
    open?: boolean; search?: string; limit?: number; offset?: number;
  }) => api.get<InvoiceListResponse>('/api/invoices', params),
  get: (id: string) => api.get<InvoiceDetail>(`/api/invoices/${id}`),
  create: (input: unknown) =>
    api.post<{ id: string; number: string; totalPaise: number; journalEntryId: string | null }>(
      '/api/invoices',
      input,
    ),
  send: (id: string) => api.post<{ id: string; status: string }>(`/api/invoices/${id}`, { action: 'send' }),
  void: (id: string, reason?: string) =>
    api.post<{ id: string; status: string }>(`/api/invoices/${id}`, { action: 'void', reason }),
};

export interface BillListItem {
  id: string;
  internalNo: string;
  vendorInvoiceNo: string;
  date: string;
  dueDate: string;
  status: string;
  isRcm: boolean;
  vendorId: string;
  vendorName: string;
  isMsme: boolean;
  subtotalPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  balancePaise: number;
  tdsPaise: number;
  tdsSection: string | null;
}

export interface BillListResponse {
  bills: BillListItem[];
  summary: { count: number; totalPaise: number; duePaise: number };
}

export interface BillDetail {
  id: string;
  internalNo: string;
  vendorInvoiceNo: string;
  date: string;
  dueDate: string;
  status: string;
  isRcm: boolean;
  placeOfSupply: string;
  supplyType: string;
  vendor: { id: string; name: string; gstin: string | null; address: string | null; isMsme: boolean };
  branch: { id: string; name: string; gstin: string | null };
  notes: string | null;
  subtotalPaise: number;
  tax: { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  tdsPaise: number;
  tdsSection: string | null;
  roundOffPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  balancePaise: number;
  lines: {
    id: string; accountName: string | null; description: string | null; hsnSac: string | null;
    qty: number; uqc: string | null; ratePaise: number; discountPct: number; gstRatePct: number;
    taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number;
    totalPaise: number; itcEligibility: string;
  }[];
  payments: { id: string; number: string; date: string; mode: string; amountPaise: number }[];
  journalEntryId: string | null;
  journalLines: InvoiceJournalLine[];
}

export interface ExpenseListItem {
  id: string;
  number: string;
  date: string;
  accountId: string;
  accountName: string;
  accountCode: string;
  paidThrough: string;
  vendorName: string | null;
  reference: string | null;
  notes: string | null;
  status: string;
  itcEligibility: string;
  isBillable: boolean;
  amountPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export const bills = {
  list: (params?: {
    from?: string; to?: string; status?: string; vendorId?: string;
    open?: boolean; search?: string; limit?: number; offset?: number;
  }) => api.get<BillListResponse>('/api/bills', params),
  get: (id: string) => api.get<BillDetail>(`/api/bills/${id}`),
  create: (input: unknown) =>
    api.post<{ id: string; internalNo: string; totalPaise: number; journalEntryId: string | null }>(
      '/api/bills',
      input,
    ),
  void: (id: string, reason?: string) =>
    api.post<{ id: string; status: string }>(`/api/bills/${id}`, { action: 'void', reason }),
};

export const expenses = {
  list: (params?: { from?: string; to?: string; accountId?: string; limit?: number }) =>
    api.get<{ expenses: ExpenseListItem[]; summary: { count: number; totalPaise: number } }>(
      '/api/expenses',
      params,
    ),
  create: (input: unknown) =>
    api.post<{ id: string; number: string; totalPaise: number; journalEntryId: string }>(
      '/api/expenses',
      input,
    ),
};

export interface PaymentListItem {
  id: string;
  number: string;
  kind: 'received' | 'made';
  date: string;
  mode: string;
  status: string;
  contactId: string;
  contactName: string;
  bankName: string;
  reference: string | null;
  amountPaise: number;
  tdsPaise: number;
  bankChargesPaise: number;
  unappliedPaise: number;
  allocationCount: number;
}

export interface PaymentListResponse {
  payments: PaymentListItem[];
  summary: { count: number; totalPaise: number; unappliedPaise: number };
}

export const payments = {
  list: (params?: {
    kind?: 'received' | 'made'; from?: string; to?: string;
    contactId?: string; limit?: number; offset?: number;
  }) => api.get<PaymentListResponse>('/api/payments', params),
  create: (input: unknown) =>
    api.post<{ id: string; number: string; unappliedPaise: number; journalEntryId: string }>(
      '/api/payments',
      input,
    ),
};

// ── Masters ──────────────────────────────────────────────────────────────────

export interface ContactRow {
  id: string;
  kind: 'customer' | 'vendor' | 'both';
  displayName: string;
  legalName: string | null;
  gstin: string | null;
  pan: string | null;
  gstTreatment: string;
  stateCode: string;
  email: string | null;
  phone: string | null;
  paymentTerms: string | null;
  creditLimitPaise: number;
  isMsme: boolean;
  msmeUdyamNo: string | null;
  tdsApplicable: boolean;
  tdsSection: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  notes: string | null;
  isArchived: boolean;
  receivablePaise: number;
  payablePaise: number;
  invoiceCount: number;
  billCount: number;
}

export interface ItemRow {
  id: string;
  kind: 'goods' | 'service';
  name: string;
  sku: string | null;
  hsnSac: string | null;
  uqc: string;
  salePricePaise: number;
  purchasePricePaise: number;
  gstRatePct: number;
  taxPref: string;
  description: string | null;
  trackInventory: boolean;
  reorderLevel: number | null;
  isArchived: boolean;
  qtySold: number;
  soldValuePaise: number;
  marginPaise: number;
}

export interface HsnCodeRow {
  id: string;
  code: string;
  kind: 'hsn' | 'sac';
  description: string;
  gstRatePct: number;
  uqc: string | null;
  isActive: boolean;
  itemCount: number;
  lineCount: number;
}

export interface ContactStatementDoc {
  id: string;
  number: string;
  vendorInvoiceNo?: string;
  date: string;
  dueDate: string;
  status: string;
  subtotalPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  balancePaise: number;
}

export interface ContactStatementPayment {
  id: string;
  number: string;
  kind: 'received' | 'made';
  date: string;
  mode: string;
  status: string;
  reference: string | null;
  bankName: string;
  amountPaise: number;
  tdsPaise: number;
  unappliedPaise: number;
}

export interface ContactDetail {
  contact: Omit<ContactRow, 'receivablePaise' | 'payablePaise' | 'invoiceCount' | 'billCount'>;
  invoices: ContactStatementDoc[];
  bills: ContactStatementDoc[];
  payments: ContactStatementPayment[];
  summary: {
    invoicedPaise: number;
    billedPaise: number;
    receivablePaise: number;
    payablePaise: number;
    receivedPaise: number;
    paidPaise: number;
  };
}

export const contacts = {
  get: (id: string) => api.get<ContactDetail>(`/api/contacts/${id}`),
  list: (params?: { kind?: 'customer' | 'vendor' | 'both' | 'all'; search?: string; archived?: boolean; limit?: number }) =>
    api.get<{ contacts: ContactRow[] }>('/api/contacts', params),
  create: (input: unknown) => api.post<{ id: string; displayName: string }>('/api/contacts', input),
  update: (input: unknown) => api.patch<{ id: string }>('/api/contacts', input),
  archive: (id: string) => api.patch<{ id: string }>('/api/contacts', { id, isArchived: true }),
};

export const items = {
  list: (params?: { kind?: 'goods' | 'service' | 'all'; search?: string; archived?: boolean; limit?: number }) =>
    api.get<{ items: ItemRow[] }>('/api/items', params),
  create: (input: unknown) => api.post<{ id: string; name: string }>('/api/items', input),
  update: (input: unknown) => api.patch<{ id: string }>('/api/items', input),
  archive: (id: string) => api.patch<{ id: string }>('/api/items', { id, isArchived: true }),
};

export const hsnCodes = {
  list: (params?: { kind?: 'hsn' | 'sac' | 'all'; prefix?: string; search?: string; activeOnly?: boolean }) =>
    api.get<{ hsnCodes: HsnCodeRow[] }>('/api/hsn-codes', params),
  create: (input: unknown) => api.post<{ id: string; code: string; kind: string }>('/api/hsn-codes', input),
  update: (input: unknown) => api.patch<{ id: string }>('/api/hsn-codes', input),
  remove: (id: string) => api.delete<{ id: string }>(`/api/hsn-codes?id=${encodeURIComponent(id)}`),
};

// ── Sales documents ──────────────────────────────────────────────────────────
//
// The five documents around an invoice. Estimates, orders and challans post
// nothing; credit notes and retainers post real entries.

export type SalesDocKind = 'estimate' | 'sales-order' | 'challan' | 'credit-note' | 'retainer';

export interface SalesDocRow {
  id: string;
  number: string;
  date: string;
  status: string;
  customerId: string;
  customerName: string;
  subtotalPaise: number;
  totalPaise: number;
  /** Invoiced-so-far on an order, applied-so-far on a credit note or retainer. */
  appliedPaise: number | null;
  /** Cash the customer has settled. Only retainers carry one. */
  paidPaise: number | null;
  /** The second string this kind carries: a reason, a purpose, a description. */
  detail: string | null;
  linkedId: string | null;
  expiry: string | null;
}

export interface SalesDocListResponse {
  kind: SalesDocKind;
  documents: SalesDocRow[];
  statusCounts: Record<string, number>;
  summary: { count: number; totalPaise: number; openPaise: number };
}

export const salesDocuments = {
  list: (kind: SalesDocKind, params?: { from?: string; to?: string; status?: string; customerId?: string; search?: string; limit?: number }) =>
    api.get<SalesDocListResponse>('/api/sales-documents', { kind, ...params }),
  create: (input: unknown) =>
    api.post<{ id: string; number: string; totalPaise: number; journalEntryId: string | null }>(
      '/api/sales-documents',
      input,
    ),
  convert: (kind: 'estimate' | 'sales-order', id: string, date: string, dueDate: string) =>
    api.patch<{ invoiceId: string; number: string; totalPaise: number }>('/api/sales-documents', {
      action: 'convert', kind, id, date, dueDate,
    }),
  setStatus: (kind: SalesDocKind, id: string, status: string) =>
    api.patch<{ id: string; status: string }>('/api/sales-documents', {
      action: 'set-status', kind, id, status,
    }),
  applyRetainer: (id: string, invoiceId: string, amountPaise?: number) =>
    api.patch<{ appliedPaise: number; journalEntryId: string }>('/api/sales-documents', {
      action: 'apply-retainer', id, invoiceId, amountPaise,
    }),
  refundCreditNote: (id: string, bankAccountId: string, date: string, amountPaise?: number, reference?: string) =>
    api.patch<{ refundedPaise: number; journalEntryId: string }>('/api/sales-documents', {
      action: 'refund-credit-note', id, bankAccountId, date, amountPaise, reference,
    }),
  voidCreditNote: (id: string, reason?: string) =>
    api.patch<{ id: string; status: string }>('/api/sales-documents', {
      action: 'void-credit-note', id, reason,
    }),
};

// ── Purchase documents ───────────────────────────────────────────────────────

export type PurchaseDocKind = 'purchase-order' | 'vendor-credit';

export interface PurchaseDocRow {
  id: string;
  number: string;
  date: string;
  status: string;
  vendorId: string;
  vendorName: string;
  isMsme: boolean;
  subtotalPaise: number;
  totalPaise: number;
  /** Billed-so-far on an order, applied-so-far on a credit. */
  appliedPaise: number;
  expected: string | null;
  reason: string | null;
  linkedId: string | null;
}

export interface PurchaseDocListResponse {
  kind: PurchaseDocKind;
  documents: PurchaseDocRow[];
  statusCounts: Record<string, number>;
  summary: { count: number; totalPaise: number; openPaise: number };
}

export const purchaseDocuments = {
  list: (kind: PurchaseDocKind, params?: { from?: string; to?: string; status?: string; vendorId?: string; search?: string; limit?: number }) =>
    api.get<PurchaseDocListResponse>('/api/purchase-documents', { kind, ...params }),
  create: (input: unknown) =>
    api.post<{ id: string; number: string; totalPaise: number; journalEntryId: string | null }>(
      '/api/purchase-documents',
      input,
    ),
  convert: (id: string, vendorInvoiceNo: string, date: string, dueDate: string) =>
    api.patch<{ billId: string; internalNo: string; totalPaise: number }>('/api/purchase-documents', {
      action: 'convert', id, vendorInvoiceNo, date, dueDate,
    }),
  setStatus: (id: string, status: 'open' | 'closed' | 'cancelled') =>
    api.patch<{ id: string; status: string }>('/api/purchase-documents', {
      action: 'set-status', id, status,
    }),
  refundVendorCredit: (id: string, bankAccountId: string, date: string, amountPaise?: number, reference?: string) =>
    api.patch<{ refundedPaise: number; journalEntryId: string }>('/api/purchase-documents', {
      action: 'refund-vendor-credit', id, bankAccountId, date, amountPaise, reference,
    }),
  voidVendorCredit: (id: string, reason?: string) =>
    api.patch<{ id: string; status: string }>('/api/purchase-documents', {
      action: 'void-vendor-credit', id, reason,
    }),
};

// ── Chart of accounts ────────────────────────────────────────────────────────

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subtype: string | null;
  parentId: string | null;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  debitPaise: number;
  creditPaise: number;
  /** Signed in the account's own direction: positive means a normal balance. */
  balancePaise: number;
  lineCount: number;
}

export const accounts = {
  list: (params?: { type?: string; search?: string; inactive?: boolean; asOf?: string }) =>
    api.get<{ accounts: AccountRow[] }>('/api/accounts', params),
  create: (input: unknown) => api.post<{ id: string; code: string; name: string }>('/api/accounts', input),
  update: (input: unknown) => api.patch<{ id: string }>('/api/accounts', input),
  remove: (id: string) => api.delete<{ id: string }>(`/api/accounts?id=${encodeURIComponent(id)}`),
};

// ── Audit trail ──────────────────────────────────────────────────────────────

export interface AuditEventRow {
  id: string;
  at: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string;
  detail: string;
  ip: string | null;
}

export interface AuditResponse {
  events: AuditEventRow[];
  targetTypes: { value: string; count: number }[];
  total: number;
}

export const audit = {
  list: (params?: {
    targetType?: string; action?: string; actorUserId?: string;
    from?: string; to?: string; search?: string; limit?: number; offset?: number;
  }) => api.get<AuditResponse>('/api/audit', params),
};

// ── Period locks ─────────────────────────────────────────────────────────────

export interface TransactionLockRow {
  module: 'sales' | 'purchases' | 'banking' | 'accountant';
  id: string | null;
  lockedUpto: string | null;
  reason: string | null;
  lockedBy: string | null;
  updatedAt: string | null;
  protectedEntries: number;
}

export const transactionLocks = {
  list: () => api.get<{ locks: TransactionLockRow[] }>('/api/transaction-locks'),
  set: (module: string, lockedUpto: string | null, reason?: string | null) =>
    api.put<{ module: string; lockedUpto: string | null }>('/api/transaction-locks', {
      module, lockedUpto, reason,
    }),
};

// ── Budgets ──────────────────────────────────────────────────────────────────

export interface BudgetRow {
  id: string;
  accountId: string;
  code: string;
  name: string;
  type: string;
  budgetPaise: number;
  actualPaise: number;
  variancePaise: number;
  pct: number;
  notes: string | null;
}

export interface BudgetResponse {
  fy: string;
  from: string;
  to: string;
  asOf: string;
  /** How far through the financial year the comparison runs. */
  elapsedPct: number;
  rows: BudgetRow[];
  totals: { budgetPaise: number; actualPaise: number };
}

export const budgets = {
  list: (params?: { fy?: string; asOf?: string }) => api.get<BudgetResponse>('/api/budgets', params),
  set: (fy: string, entries: { accountId: string; amountPaise: number; notes?: string | null }[]) =>
    api.put<{ fy: string; updated: number }>('/api/budgets', { fy, entries }),
};

// ── Period close ─────────────────────────────────────────────────────────────

export interface PeriodCheck {
  id: string;
  label: string;
  detail: string;
  count: number;
  href: string;
  blocking: boolean;
}

export interface PeriodCloseResponse {
  from: string;
  to: string;
  checks: PeriodCheck[];
  passed: number;
  blockers: number;
}

export const periodClose = {
  status: (from: string, to: string) =>
    api.get<PeriodCloseResponse>('/api/period-close', { from, to }),
};

// ── Recurring journals ───────────────────────────────────────────────────────

export interface RecurringJournalRow {
  id: string;
  name: string;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  nextRun: string;
  endDate: string | null;
  debitAccountId: string;
  debitCode: string;
  debitName: string;
  creditAccountId: string;
  creditCode: string;
  creditName: string;
  amountPaise: number;
  memo: string | null;
  isActive: boolean;
  lastPostedAt: string | null;
  isDue: boolean;
}

export const recurringJournals = {
  list: () => api.get<{ profiles: RecurringJournalRow[] }>('/api/recurring-journals'),
  create: (input: unknown) => api.post<{ id: string; name: string }>('/api/recurring-journals', input),
  run: (id: string, date?: string) =>
    api.patch<{ id: string; entryId: string; entryNo: number; postedOn: string }>(
      '/api/recurring-journals',
      { action: 'run', id, date },
    ),
  toggle: (id: string, isActive: boolean) =>
    api.patch<{ id: string; isActive: boolean }>('/api/recurring-journals', {
      action: 'toggle', id, isActive,
    }),
  remove: (id: string) => api.delete<{ id: string }>(`/api/recurring-journals?id=${encodeURIComponent(id)}`),
};

// ── MSME tracker ─────────────────────────────────────────────────────────────

export interface MsmeBillRow {
  billId: string;
  internalNo: string;
  vendorInvoiceNo: string;
  vendorId: string;
  vendorName: string;
  udyamNo: string | null;
  date: string;
  dueDate: string;
  age: number;
  daysLeft: number;
  balancePaise: number;
  totalPaise: number;
  risk: 'breached' | 'critical' | 'safe';
}

export interface MsmeTrackerResponse {
  asOf: string;
  items: MsmeBillRow[];
  summary: {
    breached: number;
    critical: number;
    safe: number;
    atRiskPaise: number;
    totalOwedPaise: number;
  };
}

export const msmeTracker = {
  list: () => api.get<MsmeTrackerResponse>('/api/msme-tracker'),
};

// ── GST ──────────────────────────────────────────────────────────────────────

export interface Gstr1Row {
  id: string;
  number: string;
  date: string;
  customerName: string;
  gstin: string | null;
  placeOfSupply: string;
  supplyType: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  totalPaise: number;
  reason?: string;
  againstNumber?: string | null;
  irnStatus?: string;
}

export interface Gstr1Response {
  view: 'gstr1';
  period: { month: string; from: string; to: string };
  gstin: string | null;
  b2b: Gstr1Row[];
  b2cl: Gstr1Row[];
  b2cs: Gstr1Row[];
  exports: Gstr1Row[];
  creditNotes: Gstr1Row[];
  hsn: { code: string; description: string | null; uqc: string; qty: number; taxablePaise: number; taxPaise: number }[];
  totals: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  documentSummary: { from: string; to: string; total: number; cancelled: number };
  issues: { level: 'error' | 'warning'; message: string }[];
  invoiceCount: number;
}

export interface Gstr3bResponse {
  view: 'gstr3b';
  period: { month: string; from: string; to: string };
  outward: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number };
  inwardRcm: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };
  itc: { cgstPaise: number; sgstPaise: number; igstPaise: number; blockedPaise: number };
  setOff: { head: 'IGST' | 'CGST' | 'SGST'; liabilityPaise: number; creditUsedPaise: number; cashPaise: number }[];
  totalCashPaise: number;
}

export interface EinvoiceRow {
  id: string;
  invoiceId: string;
  number: string;
  date: string;
  customerName: string;
  gstin: string | null;
  totalPaise: number;
  status: string;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  errorMessage: string | null;
  attempts: number;
  daysLeft: number;
}

export interface EwayBillRow {
  id: string | null;
  invoiceId: string;
  number: string;
  date: string;
  customerName: string;
  placeOfSupply: string;
  totalPaise: number;
  ewayBillNo: string | null;
  status: string;
  vehicleNo: string | null;
  transporterName: string | null;
  distanceKm: number | null;
  validUntil: string | null;
}

export interface ItcMatchRow {
  id: string | null;
  vendorGstin: string;
  vendorName: string | null;
  invoiceNo: string;
  invoiceDate: string;
  portalTaxPaise: number;
  booksTaxPaise: number;
  differencePaise: number;
  matchStatus: 'matched' | 'mismatch' | 'missing_in_books' | 'missing_in_portal';
  billId: string | null;
  billNo: string | null;
  itcAvailable: boolean;
}

export interface TdsResponse {
  view: 'tds';
  from: string;
  to: string;
  deducted: {
    section: string; vendorName: string; vendorId: string; pan: string | null;
    billCount: number; taxablePaise: number; tdsPaise: number; ratePct: number;
  }[];
  deductedTotalPaise: number;
  withheldByCustomersPaise: number;
  withheldRows: {
    paymentId: string; number: string; date: string;
    customerName: string; tdsPaise: number; amountPaise: number;
  }[];
}

export const gst = {
  gstr1: (period: string, branchId?: string) =>
    api.get<Gstr1Response>('/api/gst', { view: 'gstr1', period, branchId }),
  gstr3b: (period: string) => api.get<Gstr3bResponse>('/api/gst', { view: 'gstr3b', period }),
  einvoices: (status?: string) =>
    api.get<{ einvoices: EinvoiceRow[]; statusCounts: Record<string, number> }>('/api/gst', {
      view: 'einvoices', status,
    }),
  ewayBills: () => api.get<{ ewayBills: EwayBillRow[] }>('/api/gst', { view: 'eway-bills' }),
  itc: (period: string) =>
    api.get<{ period: string; rows: ItcMatchRow[]; summary: Record<string, number> & { atRiskPaise: number } }>(
      '/api/gst',
      { view: 'itc', period },
    ),
  tds: (from?: string, to?: string) => api.get<TdsResponse>('/api/gst', { view: 'tds', from, to }),
  submitEinvoice: (invoiceId: string) =>
    api.post<{ irn: string; ackNo: string; status: string }>('/api/gst', {
      action: 'submit-einvoice', invoiceId,
    }),
  generateEwayBill: (input: unknown) =>
    api.post<{ ewayBillNo: string; status: string; validUntil?: string; validDays?: number }>(
      '/api/gst',
      { action: 'generate-eway-bill', ...(input as object) },
    ),
};

// ── Recurring invoices ───────────────────────────────────────────────────────

export interface RecurringInvoiceRow {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  endDate: string | null;
  nextRun: string;
  paymentTerms: string | null;
  autoSend: boolean;
  isActive: boolean;
  lastGeneratedAt: string | null;
  lineCount: number;
  taxablePaise: number;
  totalPaise: number;
  isDue: boolean;
}

export const recurringInvoices = {
  list: () => api.get<{ profiles: RecurringInvoiceRow[] }>('/api/recurring-invoices'),
  create: (input: unknown) => api.post<{ id: string; name: string }>('/api/recurring-invoices', input),
  run: (id: string, date?: string) =>
    api.patch<{ id: string; invoiceId: string; number: string; totalPaise: number; autoSent: boolean }>(
      '/api/recurring-invoices',
      { action: 'run', id, date },
    ),
  toggle: (id: string, isActive: boolean) =>
    api.patch<{ id: string; isActive: boolean }>('/api/recurring-invoices', {
      action: 'toggle', id, isActive,
    }),
  remove: (id: string) => api.delete<{ id: string }>(`/api/recurring-invoices?id=${encodeURIComponent(id)}`),
};

// ── Inventory ────────────────────────────────────────────────────────────────

export interface StockRow {
  itemId: string;
  name: string;
  sku: string | null;
  uqc: string;
  openingQty: number;
  boughtQty: number;
  soldQty: number;
  adjustedQty: number;
  qty: number;
  reorderLevel: number;
  unitCostPaise: number;
  valuePaise: number;
}

export interface StockResponse {
  view: 'stock';
  items: StockRow[];
  summary: {
    totalValuePaise: number;
    lowStock: number;
    outOfStock: number;
    negative: number;
    tracked: number;
  };
}

export interface StockAdjustmentRow {
  id: string;
  date: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  uqc: string;
  qtyDelta: number;
  reason: string;
  notes: string | null;
  warehouseName: string | null;
  userName: string | null;
  valuePaise: number;
  journalEntryId: string | null;
}

export interface WarehouseRow {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  branchId: string | null;
  branchName: string | null;
  isPrimary: boolean;
  isActive: boolean;
}

export const inventory = {
  stock: () => api.get<StockResponse>('/api/inventory', { view: 'stock' }),
  adjustments: (itemId?: string) =>
    api.get<{ adjustments: StockAdjustmentRow[] }>('/api/inventory', { view: 'adjustments', itemId }),
  warehouses: () => api.get<{ warehouses: WarehouseRow[] }>('/api/inventory', { view: 'warehouses' }),
  adjust: (input: unknown) =>
    api.post<{ id: string; valuePaise: number; journalEntryId: string | null }>('/api/inventory', input),
  createWarehouse: (input: unknown) => api.put<{ id: string; name: string }>('/api/inventory', input),
};

// ── Reports ──────────────────────────────────────────────────────────────────

export interface AccountBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subtype: string | null;
  debitPaise: number;
  creditPaise: number;
  /** Signed in the account's own direction: positive means a normal balance. */
  balancePaise: number;
}

export interface TrialBalanceReport {
  report: 'trial-balance';
  asOf: string;
  rows: (AccountBalanceRow & { debitSide: number; creditSide: number })[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface ProfitAndLossReport {
  report: 'profit-and-loss';
  incomeRows: AccountBalanceRow[];
  expenseRows: AccountBalanceRow[];
  totalIncome: number;
  totalExpense: number;
  grossProfit: number;
  netProfit: number;
  from: string;
  to: string;
}

export interface BalanceSheetReport {
  report: 'balance-sheet';
  assetRows: AccountBalanceRow[];
  liabilityRows: AccountBalanceRow[];
  equityRows: AccountBalanceRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currentPeriodEarnings: number;
  balanced: boolean;
  asOf: string;
}

export interface GeneralLedgerReport {
  report: 'general-ledger';
  account: { id: string; code: string; name: string; type: string };
  from: string;
  to: string;
  openingPaise: number;
  closingPaise: number;
  lines: {
    entryId: string; entryNo: number; date: string; memo: string | null;
    description: string | null; sourceType: string; debitPaise: number;
    creditPaise: number; runningPaise: number; contactName: string | null;
  }[];
}

export interface AgeingReport {
  report: 'ar-ageing' | 'ap-ageing';
  asOf: string;
  side: 'receivable' | 'payable';
  rows: { contactId: string; name: string; buckets: Record<string, number>; totalPaise: number }[];
  totals: Record<string, number>;
  grandTotalPaise: number;
}

export const AGEING_BUCKETS = ['Current', '1–15', '16–30', '31–45', '46–60', '60+'] as const;

// ── Analysis reports ─────────────────────────────────────────────────────────
//
// The statements above say what the books hold. These say what that means —
// who owes what, which items sell, how fast money arrives. Every one is an
// aggregate over the same journal and documents, so none can contradict a
// statement.

interface Period { from: string; to: string }

export interface PartyBalanceRow {
  contactId: string;
  name: string;
  gstin: string | null;
  isMsme: boolean;
  invoicedPaise: number;
  receivedPaise: number;
  outstandingPaise: number;
  documentCount: number;
}

export interface SalesByRow {
  key: string;
  name: string;
  /** GSTIN for a party, SKU for an item, email for a salesperson. */
  detail: string | null;
  taxablePaise: number;
  taxPaise: number;
  totalPaise: number;
  qty: number;
  count: number;
}

export interface PartyBalancesReport extends Period {
  report: 'customer-balances' | 'vendor-balances';
  rows: PartyBalanceRow[];
}

export interface SalesByReport extends Period {
  report: 'sales-by-customer' | 'sales-by-item' | 'sales-by-salesperson' | 'purchases-by-vendor';
  rows: SalesByRow[];
}

export interface ExpensesByCategoryReport extends Period {
  report: 'expenses-by-category';
  rows: { accountId: string; code: string; name: string; amountPaise: number; count: number }[];
}

export interface AccountTypeSummaryReport {
  report: 'account-type-summary';
  asOf: string;
  rows: {
    type: string; accounts: number; totalAccounts: number;
    debitPaise: number; creditPaise: number; netPaise: number;
  }[];
}

export interface CashFlowReport extends Period {
  report: 'cash-flow';
  openingPaise: number;
  closingPaise: number;
  operatingPaise: number;
  investingPaise: number;
  financingPaise: number;
  rows: { label: string; group: string; amountPaise: number }[];
}

export interface BusinessRatiosReport extends Period {
  report: 'business-ratios';
  ratios: {
    key: string; label: string; value: number;
    unit: 'pct' | 'ratio' | 'days'; explain: string; good: boolean | null;
  }[];
}

export interface MovementOfEquityReport extends Period {
  report: 'movement-of-equity';
  opening: number;
  closing: number;
  rows: { label: string; amountPaise: number }[];
}

export interface RefundHistoryReport extends Period {
  report: 'refund-history';
  rows: {
    id: string; direction: 'out' | 'in'; date: string; number: string;
    party: string; reason: string; againstNumber: string | null;
    amountPaise: number; bankName: string | null;
  }[];
}

export interface TimeToGetPaidReport extends Period {
  report: 'time-to-get-paid';
  rows: {
    invoiceId: string; number: string; customer: string; date: string;
    dueDate: string; settledOn: string; days: number; vsTerms: number; totalPaise: number;
  }[];
  averageDays: number;
  onTimePct: number;
}

export const reports = {
  trialBalance: (to: string, branchId?: string) =>
    api.get<TrialBalanceReport>('/api/reports', { report: 'trial-balance', to, branchId }),
  profitAndLoss: (from: string, to: string, branchId?: string) =>
    api.get<ProfitAndLossReport>('/api/reports', { report: 'profit-and-loss', from, to, branchId }),
  balanceSheet: (to: string, branchId?: string) =>
    api.get<BalanceSheetReport>('/api/reports', { report: 'balance-sheet', to, branchId }),
  generalLedger: (accountId: string, from: string, to: string) =>
    api.get<GeneralLedgerReport>('/api/reports', { report: 'general-ledger', accountId, from, to }),
  ageing: (side: 'ar' | 'ap', to: string) =>
    api.get<AgeingReport>('/api/reports', { report: side === 'ar' ? 'ar-ageing' : 'ap-ageing', to }),

  partyBalances: (side: 'customer' | 'vendor', from: string, to: string) =>
    api.get<PartyBalancesReport>('/api/reports', {
      report: side === 'customer' ? 'customer-balances' : 'vendor-balances', from, to,
    }),
  salesBy: (by: 'customer' | 'item' | 'salesperson', from: string, to: string) =>
    api.get<SalesByReport>('/api/reports', { report: `sales-by-${by}`, from, to }),
  purchasesByVendor: (from: string, to: string) =>
    api.get<SalesByReport>('/api/reports', { report: 'purchases-by-vendor', from, to }),
  expensesByCategory: (from: string, to: string) =>
    api.get<ExpensesByCategoryReport>('/api/reports', { report: 'expenses-by-category', from, to }),
  accountTypeSummary: (from: string, to: string) =>
    api.get<AccountTypeSummaryReport>('/api/reports', { report: 'account-type-summary', from, to }),
  cashFlow: (from: string, to: string) =>
    api.get<CashFlowReport>('/api/reports', { report: 'cash-flow', from, to }),
  businessRatios: (from: string, to: string) =>
    api.get<BusinessRatiosReport>('/api/reports', { report: 'business-ratios', from, to }),
  movementOfEquity: (from: string, to: string) =>
    api.get<MovementOfEquityReport>('/api/reports', { report: 'movement-of-equity', from, to }),
  timeToGetPaid: (from: string, to: string) =>
    api.get<TimeToGetPaidReport>('/api/reports', { report: 'time-to-get-paid', from, to }),
  refundHistory: (from: string, to: string) =>
    api.get<RefundHistoryReport>('/api/reports', { report: 'refund-history', from, to }),
};

export interface JournalLineRow {
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  description: string | null;
  contactName: string | null;
  debitPaise: number;
  creditPaise: number;
}

export interface JournalEntryRow {
  id: string;
  entryNo: number;
  date: string;
  memo: string | null;
  sourceType: string;
  sourceId: string | null;
  reversalOf: string | null;
  totalDebitPaise: number;
  totalCreditPaise: number;
  postedAt: string;
  lines: JournalLineRow[];
}

export interface JournalResponse {
  entries: JournalEntryRow[];
  summary: { count: number; totalDebitPaise: number };
}

export const journal = {
  list: (params?: {
    entryId?: string; from?: string; to?: string; sourceType?: string;
    accountId?: string; search?: string; limit?: number; offset?: number;
  }) => api.get<JournalResponse>('/api/journal', params),
  create: (input: unknown) =>
    api.post<{ id: string; entryNo: number; totalDebitPaise: number }>('/api/journal', input),
  reverse: (entryId: string, memo?: string) =>
    api.patch<{ id: string; entryNo: number }>('/api/journal', { entryId, memo }),
};

export const masters = {
  load: (params?: { date?: string; branchId?: string }) =>
    api.get<Record<string, never[]> & { nextInvoiceNumber: string | null }>('/api/masters', params),
};

// ── Navigation and search ────────────────────────────────────────────────────

export interface NavCounts {
  einvoicePending: number;
  unmatched: number;
  msmeRisk: number;
}

export const navCounts = {
  load: () => api.get<NavCounts>('/api/nav-counts'),
};

export interface SearchResponse {
  invoices: {
    id: string; number: string; party: string; date: string;
    totalPaise: number; status: string;
  }[];
  bills: {
    id: string; number: string; vendorNumber: string | null; party: string;
    date: string; totalPaise: number; status: string;
  }[];
  payments: {
    id: string; number: string; kind: 'received' | 'made'; party: string;
    date: string; totalPaise: number; reference: string | null;
  }[];
  expenses: {
    id: string; number: string; party: string; date: string;
    totalPaise: number; notes: string | null;
  }[];
}

export const search = {
  run: (q: string) => api.get<SearchResponse>('/api/search', { q }),
};
