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
};

export const invoices = {
  list: (params?: {
    from?: string; to?: string; status?: string; customerId?: string;
    search?: string; limit?: number; offset?: number;
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

export const masters = {
  load: (params?: { date?: string; branchId?: string }) =>
    api.get<Record<string, never[]> & { nextInvoiceNumber: string | null }>('/api/masters', params),
};
