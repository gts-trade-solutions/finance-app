// ─────────────────────────────────────────────────────────────────────────────
// Simulated third-party integrations. In production these become real network
// calls (GSP for IRP/e-way bill, an AI provider for extraction, an AA provider
// for feeds). Here they resolve canned data after a realistic delay so the
// demo shows spinners, retries and success states truthfully.
// ─────────────────────────────────────────────────────────────────────────────

import { getState, setState } from '../store';
import { genId } from '../ledger/posting';
import { logAudit } from '../services/audit';
import type { EwayBill } from '../types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deterministic 64-char IRN-looking hash from the invoice number. */
function fakeIrn(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  let out = '';
  for (let i = 0; i < 64; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out += '0123456789abcdef'[h % 16];
  }
  return out;
}

/**
 * Simulated IRP submission. ~8% of attempts "fail" with a realistic IRP error
 * so the demo can show the retry path (rotate through common codes).
 */
export async function submitToIrp(invoiceId: string, opts: { forceFail?: boolean } = {}): Promise<{ ok: boolean; irn?: string; error?: string }> {
  await sleep(1800);
  const s = getState();
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) return { ok: false, error: 'Invoice not found' };

  const shouldFail = opts.forceFail ?? inv.number.endsWith('7');
  if (shouldFail) {
    const error = '2172: For intra-state transaction IGST amounts are not applicable, only CGST and SGST';
    setState({
      invoices: getState().invoices.map((i) =>
        i.id === invoiceId ? { ...i, einvoice: { ...i.einvoice, status: 'failed', error } } : i,
      ),
    });
    logAudit('update', 'invoice', invoiceId, inv.number, `IRP submission failed — ${error}`);
    return { ok: false, error };
  }

  const irn = fakeIrn(inv.number);
  const ackNo = String(112000000000000 + (inv.number.charCodeAt(inv.number.length - 1) * 7919));
  const qrPayload = JSON.stringify({
    SellerGstin: s.branches.find((b) => b.id === inv.branchId)?.gstin,
    BuyerGstin: s.contacts.find((c) => c.id === inv.customerId)?.gstin ?? 'URP',
    DocNo: inv.number,
    DocDt: inv.date,
    TotInvVal: (inv.totalPaise / 100).toFixed(2),
    Irn: irn,
  });

  setState({
    invoices: getState().invoices.map((i) =>
      i.id === invoiceId
        ? {
            ...i,
            einvoice: {
              status: 'submitted',
              irn,
              ackNo,
              ackDate: new Date().toISOString().slice(0, 10),
              qrPayload,
            },
          }
        : i,
    ),
  });
  logAudit('update', 'invoice', invoiceId, inv.number, `IRN generated — ${irn.slice(0, 16)}…`);
  return { ok: true, irn };
}

export async function cancelIrn(invoiceId: string, reason: string): Promise<void> {
  await sleep(1200);
  const inv = getState().invoices.find((i) => i.id === invoiceId);
  setState({
    invoices: getState().invoices.map((i) =>
      i.id === invoiceId ? { ...i, einvoice: { ...i.einvoice, status: 'cancelled' } } : i,
    ),
  });
  if (inv) logAudit('update', 'invoice', invoiceId, inv.number, `IRN cancelled — ${reason}`);
}

export async function generateEwayBill(input: {
  invoiceId: string;
  vehicleNo: string;
  transporterId?: string;
  distanceKm: number;
}): Promise<EwayBill> {
  await sleep(1500);
  const inv = getState().invoices.find((i) => i.id === input.invoiceId)!;
  const validDays = Math.max(1, Math.ceil(input.distanceKm / 200));
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validDays);
  const ewb: EwayBill = {
    id: genId('ewb'),
    invoiceId: input.invoiceId,
    ewbNo: String(391000000000 + Math.floor(Math.random() * 899999999)),
    vehicleNo: input.vehicleNo,
    transporterId: input.transporterId,
    distanceKm: input.distanceKm,
    generatedAt: new Date().toISOString(),
    validUntil: validUntil.toISOString().slice(0, 10),
    status: 'active',
  };
  setState({
    ewayBills: [ewb, ...getState().ewayBills],
    invoices: getState().invoices.map((i) =>
      i.id === input.invoiceId ? { ...i, ewayBillNo: ewb.ewbNo } : i,
    ),
  });
  logAudit('create', 'eway_bill', ewb.id, ewb.ewbNo, `Generated for ${inv.number}, valid ${validDays} day(s)`);
  return ewb;
}

/** Simulated Account Aggregator pull — appends a fresh tranche of lines. */
export async function fetchBankFeed(bankAccountId: string): Promise<number> {
  await sleep(1600);
  const { importBankTxns } = await import('../services/banking');
  const today = new Date();
  const d = (n: number) => {
    const x = new Date(today);
    x.setDate(x.getDate() - n);
    return x.toISOString().slice(0, 10);
  };
  const batch = [
    { date: d(0), amountPaise: 8_85_000, direction: 'in' as const, narration: 'NEFT CR DECCAN WHEELS', reference: 'FEED001' },
    { date: d(0), amountPaise: 2_360, direction: 'out' as const, narration: 'AIRTEL BROADBAND BILL', reference: 'FEED002' },
    { date: d(1), amountPaise: 5_200, direction: 'out' as const, narration: 'BHARAT PETRO FUEL ADYAR', reference: 'FEED003' },
  ];
  const res = importBankTxns(bankAccountId, batch, `AA-Feed-${d(0)}`);
  return res.imported;
}

// ── AI simulators ────────────────────────────────────────────────────────────

export interface ExtractedBill {
  vendorGuess: string;
  vendorId: string | null;
  invoiceNo: string;
  date: string;
  lines: { description: string; qty: number; rate: number; gstRatePct: number }[];
  taxableRupees: number;
  taxRupees: number;
  totalRupees: number;
  confidence: number;
  warnings: string[];
}

/** Scripted OCR extraction — always returns the same believable bill. */
export async function extractDocument(fileName: string): Promise<ExtractedBill> {
  await sleep(2400);
  return {
    vendorGuess: 'Bosch Automotive Distributors',
    vendorId: 'v_bosch',
    invoiceNo: 'BOS/26-27/1301',
    date: new Date().toISOString().slice(0, 10),
    lines: [
      { description: 'Spark Plug Iridium (4-pack)', qty: 40, rate: 1290, gstRatePct: 28 },
      { description: 'Air Filter – Creta 1.5', qty: 25, rate: 340, gstRatePct: 18 },
    ],
    taxableRupees: 60_100,
    taxRupees: 15_990,
    totalRupees: 76_090,
    confidence: 0.94,
    warnings: [
      `Read from “${fileName}” — verify the vendor invoice number before approving.`,
      'HSN on line 2 not printed on the document; defaulted from item master.',
    ],
  };
}

export interface AnomalyFlag {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  entityLabel: string;
  action: string;
}

/** Anomaly detection over the actual seeded data — real checks, not canned text. */
export function detectAnomalies(): AnomalyFlag[] {
  const s = getState();
  const flags: AnomalyFlag[] = [];

  // 1. Duplicate bill suspicion: same vendor + same amount within 30 days
  for (let i = 0; i < s.bills.length; i++) {
    for (let j = i + 1; j < s.bills.length; j++) {
      const a = s.bills[i];
      const b = s.bills[j];
      if (a.vendorId !== b.vendorId || a.totalPaise !== b.totalPaise) continue;
      const gap = Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) / 86_400_000;
      if (gap <= 30) {
        flags.push({
          id: `dup_${a.id}_${b.id}`,
          severity: 'high',
          title: 'Possible duplicate bill',
          detail: `${a.internalNo} and ${b.internalNo} are the same vendor and identical amount, ${Math.round(gap)} days apart.`,
          entityLabel: a.internalNo,
          action: 'Review both bills',
        });
      }
    }
  }

  // 2. MSME bills approaching the 45-day statutory limit
  const today = new Date();
  for (const bill of s.bills) {
    const vendor = s.contacts.find((c) => c.id === bill.vendorId);
    if (!vendor?.isMsme || bill.status === 'paid' || bill.status === 'void') continue;
    const age = Math.floor((today.getTime() - new Date(bill.date).getTime()) / 86_400_000);
    if (age >= 35) {
      flags.push({
        id: `msme_${bill.id}`,
        severity: age >= 45 ? 'high' : 'medium',
        title: age >= 45 ? 'MSME payment overdue — expense disallowed' : 'MSME 45-day limit approaching',
        detail: `${vendor.displayName} bill ${bill.internalNo} is ${age} days old. Section 43B(h) disallows the expense if unpaid past 45 days.`,
        entityLabel: bill.internalNo,
        action: 'Pay now',
      });
    }
  }

  // 3. ITC at risk — booked but vendor hasn't filed
  for (const e of s.gstr2b) {
    if (e.matchStatus === 'missing_in_2b') {
      flags.push({
        id: `itc_${e.id}`,
        severity: 'high',
        title: 'ITC at risk — supplier has not filed',
        detail: `${e.vendorName} invoice ${e.invoiceNo}: ₹${(e.taxPaise / 100).toLocaleString('en-IN')} of credit is claimed in books but absent from GSTR-2B.`,
        entityLabel: e.invoiceNo,
        action: 'Chase vendor',
      });
    }
    if (e.matchStatus === 'missing_in_books') {
      flags.push({
        id: `book_${e.id}`,
        severity: 'medium',
        title: 'Unbooked purchase — ITC available',
        detail: `${e.vendorName} filed ${e.invoiceNo} but no bill exists in books. ₹${(e.taxPaise / 100).toLocaleString('en-IN')} credit is being missed.`,
        entityLabel: e.invoiceNo,
        action: 'Create bill',
      });
    }
  }

  // 4. Customers over credit limit
  for (const c of s.contacts) {
    if (!c.creditLimit) continue;
    const outstanding = s.invoices
      .filter((i) => i.customerId === c.id && i.status !== 'paid' && i.status !== 'void')
      .reduce((sum, i) => sum + (i.totalPaise - i.amountPaidPaise), 0);
    if (outstanding > c.creditLimit) {
      flags.push({
        id: `credit_${c.id}`,
        severity: 'medium',
        title: 'Customer over credit limit',
        detail: `${c.displayName} owes ₹${(outstanding / 100).toLocaleString('en-IN')} against a limit of ₹${(c.creditLimit / 100).toLocaleString('en-IN')}.`,
        entityLabel: c.displayName,
        action: 'Review account',
      });
    }
  }

  // 5. E-invoice deadline pressure
  const pending = s.invoices.filter((i) => i.einvoice.status === 'pending' || i.einvoice.status === 'failed');
  if (pending.length > 0) {
    flags.push({
      id: 'einv_pending',
      severity: 'high',
      title: `${pending.length} invoice(s) without an IRN`,
      detail: 'B2B invoices are not legally valid until the IRP issues an IRN. The 30-day reporting window applies.',
      entityLabel: 'E-invoicing',
      action: 'Submit to IRP',
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Scripted natural-language query — matches on keywords over real data. */
export async function askAssistant(question: string): Promise<{ answer: string; rows?: { label: string; value: string }[] }> {
  await sleep(1400);
  const s = getState();
  const q = question.toLowerCase();
  const fmt = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  if (q.includes('overdue') || q.includes('owe')) {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = s.invoices
      .filter((i) => i.status !== 'paid' && i.status !== 'void' && i.dueDate < today)
      .map((i) => ({ inv: i, bal: i.totalPaise - i.amountPaidPaise }))
      .sort((a, b) => b.bal - a.bal);
    const total = overdue.reduce((t, o) => t + o.bal, 0);
    return {
      answer: `${overdue.length} invoices are overdue, totalling ${fmt(total)}. The largest are listed below.`,
      rows: overdue.slice(0, 6).map((o) => ({
        label: `${o.inv.number} — ${s.contacts.find((c) => c.id === o.inv.customerId)?.displayName}`,
        value: fmt(o.bal),
      })),
    };
  }

  if (q.includes('top') && (q.includes('customer') || q.includes('sales'))) {
    const byCustomer = new Map<string, number>();
    for (const i of s.invoices) {
      if (i.status === 'void') continue;
      byCustomer.set(i.customerId, (byCustomer.get(i.customerId) ?? 0) + i.subtotalPaise);
    }
    const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return {
      answer: `Your top customers this financial year by net sales value:`,
      rows: top.map(([id, v]) => ({
        label: s.contacts.find((c) => c.id === id)?.displayName ?? id,
        value: fmt(v),
      })),
    };
  }

  if (q.includes('gst') || q.includes('tax')) {
    const output = s.invoices.filter((i) => i.status !== 'void')
      .reduce((t, i) => t + i.tax.cgstPaise + i.tax.sgstPaise + i.tax.igstPaise, 0);
    const input = s.bills.filter((b) => b.status !== 'void')
      .reduce((t, b) => t + b.tax.cgstPaise + b.tax.sgstPaise + b.tax.igstPaise, 0);
    return {
      answer: `Output GST collected is ${fmt(output)} and input credit available is ${fmt(input)}, leaving roughly ${fmt(Math.max(0, output - input))} payable in cash before set-off adjustments.`,
      rows: [
        { label: 'Output GST (on sales)', value: fmt(output) },
        { label: 'Input Tax Credit (on purchases)', value: fmt(input) },
        { label: 'Estimated net payable', value: fmt(Math.max(0, output - input)) },
      ],
    };
  }

  if (q.includes('cash') || q.includes('bank') || q.includes('balance')) {
    const rows = s.bankAccounts.map((b) => {
      const net = s.entries.flatMap((e) => e.lines)
        .filter((l) => l.accountId === b.ledgerAccountId)
        .reduce((t, l) => t + l.debit - l.credit, 0);
      return { label: b.name, value: fmt(net) };
    });
    const total = rows.reduce((t, r) => t + parseFloat(r.value.replace(/[₹,]/g, '')) * 100, 0);
    return { answer: `You are holding ${fmt(total)} across ${rows.length} accounts.`, rows };
  }

  return {
    answer:
      'I can answer questions about receivables, top customers, GST position and cash balances from your live ledger. Try “which invoices are overdue?”, “who are my top customers?”, “what is my GST liability?” or “how much cash do I have?”.',
  };
}
