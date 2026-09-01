import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// The compliance registers: e-invoices, e-way bills, GSTR-2B reconciliation and
// TDS.
//
// One thing runs through all four. Every figure the government holds about you
// comes from somebody else's filing — your customer's IRN, your supplier's
// GSTR-1 — and the only thing you control is whether your books agree with it.
// These screens exist to surface the disagreements while they can still be
// fixed, rather than at an assessment two years later.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'kysely';
import type { Executor, Trx } from '../db';
import type { Paise } from '../../types';
import { toPaiseFromSql } from '../money-sql';
import { badRequest, conflict, notFound } from '../http';

// ── e-invoices ───────────────────────────────────────────────────────────────

export interface EinvoiceRow {
  id: string;
  invoiceId: string;
  number: string;
  date: string;
  customerName: string;
  gstin: string | null;
  totalPaise: Paise;
  status: string;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  errorMessage: string | null;
  attempts: number;
  /** Days left of the 30-day registration window. Negative means it has passed. */
  daysLeft: number;
}

export async function einvoiceQueue(
  ex: Executor,
  orgId: number,
  status?: string,
): Promise<{ rows: EinvoiceRow[]; counts: Record<string, number> }> {
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await sql<{
    id: number; invoice_id: number; number: string; invoice_date: string;
    customer_name: string; gstin: string | null; total: string; status: string;
    irn: string | null; ack_no: string | null; ack_date: string | null;
    error_message: string | null; attempts: number; age: number;
  }>`
    SELECT e.id, e.invoice_id, i.number, i.invoice_date,
           c.display_name AS customer_name, c.gstin, i.total,
           e.status, e.irn, e.ack_no, e.ack_date, e.error_message, e.attempts,
           DATEDIFF(${today}, i.invoice_date) AS age
      FROM einvoices e
      JOIN invoices i ON i.id = e.invoice_id
      JOIN contacts c ON c.id = i.customer_id
     WHERE e.org_id = ${orgId}
       ${status && status !== 'all' ? sql`AND e.status = ${status}` : sql``}
     ORDER BY
       CASE e.status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
       i.invoice_date DESC
     LIMIT 500
  `.execute(ex);

  const { rows: counts } = await sql<{ status: string; n: string }>`
    SELECT status, COUNT(*) AS n FROM einvoices WHERE org_id = ${orgId} GROUP BY status
  `.execute(ex);

  const byStatus: Record<string, number> = { all: 0 };
  for (const c of counts) {
    byStatus[c.status] = Number(c.n);
    byStatus.all += Number(c.n);
  }

  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      invoiceId: String(r.invoice_id),
      number: r.number,
      date: String(r.invoice_date).slice(0, 10),
      customerName: r.customer_name,
      gstin: r.gstin,
      totalPaise: toPaiseFromSql(r.total),
      status: r.status,
      irn: r.irn,
      ackNo: r.ack_no,
      ackDate: r.ack_date ? String(r.ack_date).slice(0, 19).replace('T', ' ') : null,
      errorMessage: r.error_message,
      attempts: r.attempts,
      // An invoice must be registered within 30 days of its date. After that
      // the portal simply refuses it and the invoice is not legally valid.
      daysLeft: 30 - Number(r.age),
    })),
    counts: byStatus,
  };
}

/**
 * Register an invoice with the Invoice Registration Portal.
 *
 * The IRP call itself is not wired up — that needs a GSP contract and
 * production credentials, which are a commercial arrangement rather than code.
 * What *is* real is everything around it: the eligibility rules, the 30-day
 * window, the attempt count, and the fact that a registered invoice can no
 * longer be quietly edited. The IRN generated here is deterministic and clearly
 * marked so nothing can mistake it for one the government issued.
 */
export async function submitEinvoice(
  trx: Trx,
  orgId: number,
  invoiceId: number,
): Promise<{ irn: string; ackNo: string; status: string }> {
  const row = await trx
    .selectFrom('einvoices as e')
    .innerJoin('invoices as i', 'i.id', 'e.invoice_id')
    .innerJoin('contacts as c', 'c.id', 'i.customer_id')
    .innerJoin('branches as b', 'b.id', 'i.branch_id')
    .select([
      'e.id', 'e.status', 'e.attempts', 'i.number', 'i.invoice_date', 'i.status as invoice_status',
      'c.gstin as customer_gstin', 'b.gstin as branch_gstin',
    ])
    .where('e.invoice_id', '=', invoiceId)
    .where('e.org_id', '=', orgId)
    .executeTakeFirst();
  if (!row) throw notFound('That invoice has no e-invoice record.');

  if (row.status === 'submitted') throw conflict(`${row.number} already has an IRN.`);
  if (row.status === 'cancelled') throw conflict(`${row.number} was cancelled and cannot be registered.`);
  if (row.invoice_status === 'draft') throw badRequest('A draft invoice cannot be registered — issue it first.');
  if (row.invoice_status === 'void') throw badRequest('A void invoice cannot be registered.');
  if (!row.branch_gstin) throw badRequest('This branch has no GSTIN, so it cannot raise e-invoices.');
  if (!row.customer_gstin) {
    throw badRequest(
      `${row.number} has no customer GSTIN. Only B2B supplies are registered — add the GSTIN or mark the ` +
        'customer unregistered.',
    );
  }

  const age = Math.floor(
    (Date.now() - new Date(String(row.invoice_date).slice(0, 10)).getTime()) / 86_400_000,
  );
  if (age > 30) {
    await trx
      .updateTable('einvoices')
      .set({
        status: 'failed',
        attempts: row.attempts + 1,
        error_code: '2150',
        error_message:
          `The 30-day registration window closed ${age - 30} day(s) ago. The portal will no longer accept ` +
          'this invoice, so it cannot be made valid — issue a credit note and re-invoice.',
      })
      .where('id', '=', row.id)
      .execute();
    throw conflict(
      `${row.number} is ${age} days old. The IRP only accepts invoices within 30 days of their date.`,
    );
  }

  // A stand-in for the portal's response, derived from the invoice so it is
  // stable across retries. Prefixed so it can never be mistaken for a real IRN.
  const irn = `DEMO${String(orgId).padStart(4, '0')}${String(invoiceId).padStart(8, '0')}`
    .padEnd(64, '0');
  const ackNo = `1${String(invoiceId).padStart(13, '0')}`;

  await trx
    .updateTable('einvoices')
    .set({
      status: 'submitted',
      irn,
      ack_no: ackNo,
      ack_date: new Date(),
      attempts: row.attempts + 1,
      error_code: null,
      error_message: null,
    })
    .where('id', '=', row.id)
    .execute();

  return { irn, ackNo, status: 'submitted' };
}

// ── GSTR-2B reconciliation ───────────────────────────────────────────────────

export interface ItcMatchRow {
  id: string | null;
  vendorGstin: string;
  vendorName: string | null;
  invoiceNo: string;
  invoiceDate: string;
  portalTaxPaise: Paise;
  booksTaxPaise: Paise;
  differencePaise: Paise;
  matchStatus: 'matched' | 'mismatch' | 'missing_in_books' | 'missing_in_portal';
  billId: string | null;
  billNo: string | null;
  itcAvailable: boolean;
}

/**
 * Books against GSTR-2B.
 *
 * Since 2022 input credit is only claimable if the supplier actually filed the
 * invoice — what is in your books is irrelevant if it is not in your 2B. So
 * this runs the comparison in both directions: entries the portal has that you
 * do not, and bills you have that the portal does not. The second kind is the
 * expensive one, because you have probably already claimed the credit.
 */
export async function itcReconciliation(
  ex: Executor,
  orgId: number,
  period: string,
): Promise<{ rows: ItcMatchRow[]; summary: Record<string, number> & { atRiskPaise: Paise } }> {
  // 'YYYY-MM' on the wire; the table stores the portal's own 'MMYYYY'.
  const [y, m] = period.split('-');
  const returnPeriod = `${m}${y}`;
  const from = `${period}-01`;
  const to = `${period}-${String(new Date(Number(y), Number(m), 0).getDate()).padStart(2, '0')}`;

  const portal = await ex
    .selectFrom('gstr2b_entries')
    .select([
      'id', 'vendor_gstin', 'vendor_name', 'invoice_no', 'invoice_date',
      'taxable', 'cgst', 'sgst', 'igst', 'cess', 'itc_available',
      'matched_bill_id', 'match_status',
    ])
    .where('org_id', '=', orgId)
    .where('return_period', '=', returnPeriod)
    .execute();

  const bills = await ex
    .selectFrom('bills as b')
    .innerJoin('contacts as c', 'c.id', 'b.vendor_id')
    .select([
      'b.id', 'b.internal_no', 'b.vendor_invoice_no', 'b.bill_date',
      'b.cgst', 'b.sgst', 'b.igst', 'c.gstin', 'c.display_name',
    ])
    .where('b.org_id', '=', orgId)
    .where('b.status', 'not in', ['draft', 'void'])
    .where('b.bill_date', '>=', from)
    .where('b.bill_date', '<=', to)
    .execute();

  // Matched on the supplier's own invoice number, which is what the portal
  // keys on — our internal number means nothing to them.
  const billByKey = new Map(
    bills.map((b) => [`${b.gstin ?? ''}|${b.vendor_invoice_no.trim().toUpperCase()}`, b]),
  );
  const seen = new Set<string>();
  const rows: ItcMatchRow[] = [];

  for (const p of portal) {
    const key = `${p.vendor_gstin}|${p.invoice_no.trim().toUpperCase()}`;
    const bill = billByKey.get(key);
    if (bill) seen.add(key);

    const portalTax = toPaiseFromSql(p.cgst) + toPaiseFromSql(p.sgst) + toPaiseFromSql(p.igst);
    const booksTax = bill
      ? toPaiseFromSql(bill.cgst) + toPaiseFromSql(bill.sgst) + toPaiseFromSql(bill.igst)
      : 0;

    rows.push({
      id: String(p.id),
      vendorGstin: p.vendor_gstin,
      vendorName: p.vendor_name,
      invoiceNo: p.invoice_no,
      invoiceDate: String(p.invoice_date).slice(0, 10),
      portalTaxPaise: portalTax,
      booksTaxPaise: booksTax,
      differencePaise: portalTax - booksTax,
      matchStatus: !bill ? 'missing_in_books' : portalTax === booksTax ? 'matched' : 'mismatch',
      billId: bill ? String(bill.id) : null,
      billNo: bill ? bill.internal_no : null,
      itcAvailable: !!p.itc_available,
    });
  }

  // The other direction: bills we hold that the supplier has not filed.
  for (const b of bills) {
    const key = `${b.gstin ?? ''}|${b.vendor_invoice_no.trim().toUpperCase()}`;
    if (seen.has(key) || !b.gstin) continue;
    const booksTax = toPaiseFromSql(b.cgst) + toPaiseFromSql(b.sgst) + toPaiseFromSql(b.igst);
    if (booksTax === 0) continue;

    rows.push({
      id: null,
      vendorGstin: b.gstin,
      vendorName: b.display_name,
      invoiceNo: b.vendor_invoice_no,
      invoiceDate: String(b.bill_date).slice(0, 10),
      portalTaxPaise: 0,
      booksTaxPaise: booksTax,
      differencePaise: -booksTax,
      matchStatus: 'missing_in_portal',
      billId: String(b.id),
      billNo: b.internal_no,
      itcAvailable: false,
    });
  }

  const count = (s: string) => rows.filter((r) => r.matchStatus === s).length;

  return {
    rows: rows.sort((a, b) => Math.abs(b.differencePaise) - Math.abs(a.differencePaise)),
    summary: {
      total: rows.length,
      matched: count('matched'),
      mismatch: count('mismatch'),
      missing_in_books: count('missing_in_books'),
      missing_in_portal: count('missing_in_portal'),
      // Credit claimed in the books that the portal does not support. This is
      // the number that turns into a demand with interest.
      atRiskPaise: rows
        .filter((r) => r.matchStatus === 'missing_in_portal' || r.matchStatus === 'mismatch')
        .reduce((t, r) => t + Math.max(0, -r.differencePaise), 0),
    },
  };
}

// ── TDS ──────────────────────────────────────────────────────────────────────

export interface TdsRow {
  section: string;
  vendorName: string;
  vendorId: string;
  pan: string | null;
  billCount: number;
  taxablePaise: Paise;
  tdsPaise: Paise;
  ratePct: number;
}

/**
 * TDS deducted from suppliers, and TDS customers deducted from us.
 *
 * The two sides are opposite in every sense. What we deduct is a liability —
 * we are holding the government's money and must deposit it by the 7th. What
 * customers deduct from us is an asset: they have already paid it on our
 * behalf, and it comes back as credit against our own income tax.
 */
export async function tdsSummary(
  ex: Executor,
  orgId: number,
  from: string,
  to: string,
): Promise<{
  deducted: TdsRow[];
  deductedTotalPaise: Paise;
  withheldByCustomersPaise: Paise;
  withheldRows: { paymentId: string; number: string; date: string; customerName: string; tdsPaise: Paise; amountPaise: Paise }[];
}> {
  const { rows: deductedRows } = await sql<{
    section: string | null; vendor_id: number; name: string; pan: string | null;
    n: string; taxable: string; tds: string;
  }>`
    SELECT b.tds_section AS section, b.vendor_id, c.display_name AS name, c.pan,
           COUNT(*) AS n,
           COALESCE(SUM(b.subtotal), 0) AS taxable,
           COALESCE(SUM(b.tds_amount), 0) AS tds
      FROM bills b
      JOIN contacts c ON c.id = b.vendor_id
     WHERE b.org_id = ${orgId} AND b.status NOT IN ('draft', 'void')
       AND b.tds_amount > 0
       AND b.bill_date BETWEEN ${from} AND ${to}
     GROUP BY b.tds_section, b.vendor_id, c.display_name, c.pan
     ORDER BY tds DESC
  `.execute(ex);

  const deducted: TdsRow[] = deductedRows.map((r) => {
    const taxable = toPaiseFromSql(r.taxable);
    const tds = toPaiseFromSql(r.tds);
    return {
      section: r.section ?? '—',
      vendorName: r.name,
      vendorId: String(r.vendor_id),
      pan: r.pan,
      billCount: Number(r.n),
      taxablePaise: taxable,
      tdsPaise: tds,
      ratePct: taxable > 0 ? (tds / taxable) * 100 : 0,
    };
  });

  const withheld = await ex
    .selectFrom('payments as p')
    .innerJoin('contacts as c', 'c.id', 'p.contact_id')
    .select(['p.id', 'p.number', 'p.payment_date', 'p.tds_amount', 'p.amount', 'c.display_name'])
    .where('p.org_id', '=', orgId)
    .where('p.kind', '=', 'received')
    .where('p.status', '<>', 'void')
    .where('p.tds_amount', '>', '0')
    .where('p.payment_date', '>=', from)
    .where('p.payment_date', '<=', to)
    .orderBy('p.payment_date', 'desc')
    .execute();

  return {
    deducted,
    deductedTotalPaise: deducted.reduce((t, r) => t + r.tdsPaise, 0),
    withheldByCustomersPaise: withheld.reduce((t, r) => t + toPaiseFromSql(r.tds_amount), 0),
    withheldRows: withheld.map((r) => ({
      paymentId: String(r.id),
      number: r.number,
      date: String(r.payment_date).slice(0, 10),
      customerName: r.display_name,
      tdsPaise: toPaiseFromSql(r.tds_amount),
      amountPaise: toPaiseFromSql(r.amount),
    })),
  };
}
