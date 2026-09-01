import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// The GST returns: GSTR-1 (what you sold) and GSTR-3B (what you owe).
//
// Both are computed from the invoices and bills themselves, never from a stored
// summary. A return is a statement about a period that is already closed, and
// the only way it can be wrong is if it disagrees with the documents behind it
// — so there is deliberately nothing in between.
//
// The section split in GSTR-1 is not cosmetic. Which table a supply lands in
// decides whether the buyer can see it in their GSTR-2B and claim credit on it.
// Putting a B2B sale in the B2C summary means your customer silently loses
// their input credit, and they will notice at their year end, not yours.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'kysely';
import type { Executor } from '../db';
import type { Paise } from '../../types';
import { toPaiseFromSql } from '../money-sql';

/** The B2CL threshold: an inter-state sale to a consumer above this is listed. */
const B2CL_THRESHOLD: Paise = 2_50_000_00;

export interface Period {
  /** 'YYYY-MM'. */
  month: string;
  from: string;
  to: string;
}

export function monthRange(month: string): Period {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

// ── GSTR-1 ───────────────────────────────────────────────────────────────────

export interface Gstr1Row {
  id: string;
  number: string;
  date: string;
  customerName: string;
  gstin: string | null;
  placeOfSupply: string;
  supplyType: string;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  totalPaise: Paise;
  /** Only meaningful on a credit note. */
  reason?: string;
  againstNumber?: string | null;
  irnStatus?: string;
}

export interface Gstr1 {
  period: Period;
  gstin: string | null;
  b2b: Gstr1Row[];
  b2cl: Gstr1Row[];
  b2cs: Gstr1Row[];
  exports: Gstr1Row[];
  creditNotes: Gstr1Row[];
  hsn: {
    code: string;
    description: string | null;
    uqc: string;
    qty: number;
    taxablePaise: Paise;
    taxPaise: Paise;
  }[];
  totals: { taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; cessPaise: Paise };
  documentSummary: { from: string; to: string; total: number; cancelled: number };
  issues: { level: 'error' | 'warning'; message: string }[];
  invoiceCount: number;
}

export async function gstr1(ex: Executor, orgId: number, month: string, branchId?: number): Promise<Gstr1> {
  const period = monthRange(month);

  const invoiceRows = await sql<{
    id: number; number: string; invoice_date: string; status: string;
    customer_name: string; gstin: string | null; place_of_supply: string;
    supply_type: string; subtotal: string; cgst: string; sgst: string;
    igst: string; cess: string; total: string; irn_status: string | null;
  }>`
    SELECT i.id, i.number, i.invoice_date, i.status,
           c.display_name AS customer_name, c.gstin, i.place_of_supply, i.supply_type,
           i.subtotal, i.cgst, i.sgst, i.igst, i.cess, i.total,
           e.status AS irn_status
      FROM invoices i
      JOIN contacts c ON c.id = i.customer_id
      LEFT JOIN einvoices e ON e.invoice_id = i.id
     WHERE i.org_id = ${orgId}
       AND i.invoice_date BETWEEN ${period.from} AND ${period.to}
       ${branchId ? sql`AND i.branch_id = ${branchId}` : sql``}
     ORDER BY i.invoice_date, i.id
  `.execute(ex);

  const toRow = (r: (typeof invoiceRows.rows)[number]): Gstr1Row => ({
    id: String(r.id),
    number: r.number,
    date: String(r.invoice_date).slice(0, 10),
    customerName: r.customer_name,
    gstin: r.gstin,
    placeOfSupply: r.place_of_supply,
    supplyType: r.supply_type,
    taxablePaise: toPaiseFromSql(r.subtotal),
    cgstPaise: toPaiseFromSql(r.cgst),
    sgstPaise: toPaiseFromSql(r.sgst),
    igstPaise: toPaiseFromSql(r.igst),
    cessPaise: toPaiseFromSql(r.cess),
    totalPaise: toPaiseFromSql(r.total),
    irnStatus: r.irn_status ?? 'not_applicable',
  });

  // A void invoice is reported in the document summary as cancelled, not in a
  // supply table: the number was issued and must be accounted for, but no
  // supply took place. A draft was never issued at all.
  const issued = invoiceRows.rows.filter((r) => r.status !== 'draft');
  const live = issued.filter((r) => r.status !== 'void');
  const cancelled = issued.filter((r) => r.status === 'void');

  const b2b: Gstr1Row[] = [];
  const b2cl: Gstr1Row[] = [];
  const b2cs: Gstr1Row[] = [];
  const exports: Gstr1Row[] = [];

  for (const r of live) {
    const row = toRow(r);
    if (['export_lut', 'export_with_tax', 'sez'].includes(r.supply_type)) exports.push(row);
    else if (r.gstin) b2b.push(row);
    else if (r.supply_type === 'inter' && row.totalPaise > B2CL_THRESHOLD) b2cl.push(row);
    else b2cs.push(row);
  }

  const creditNoteRows = await sql<{
    id: number; number: string; note_date: string; reason: string;
    customer_name: string; gstin: string | null; place_of_supply: string; supply_type: string;
    subtotal: string; cgst: string; sgst: string; igst: string; cess: string; total: string;
    against_number: string | null;
  }>`
    SELECT n.id, n.number, n.note_date, n.reason,
           c.display_name AS customer_name, c.gstin, n.place_of_supply, n.supply_type,
           n.subtotal, n.cgst, n.sgst, n.igst, n.cess, n.total,
           i.number AS against_number
      FROM credit_notes n
      JOIN contacts c ON c.id = n.customer_id
      LEFT JOIN invoices i ON i.id = n.against_invoice_id
     WHERE n.org_id = ${orgId} AND n.status <> 'void'
       AND n.note_date BETWEEN ${period.from} AND ${period.to}
       ${branchId ? sql`AND n.branch_id = ${branchId}` : sql``}
     ORDER BY n.note_date, n.id
  `.execute(ex);

  const creditNotes: Gstr1Row[] = creditNoteRows.rows.map((r) => ({
    id: String(r.id),
    number: r.number,
    date: String(r.note_date).slice(0, 10),
    customerName: r.customer_name,
    gstin: r.gstin,
    placeOfSupply: r.place_of_supply,
    supplyType: r.supply_type,
    taxablePaise: toPaiseFromSql(r.subtotal),
    cgstPaise: toPaiseFromSql(r.cgst),
    sgstPaise: toPaiseFromSql(r.sgst),
    igstPaise: toPaiseFromSql(r.igst),
    cessPaise: toPaiseFromSql(r.cess),
    totalPaise: toPaiseFromSql(r.total),
    reason: r.reason,
    againstNumber: r.against_number,
  }));

  // Table 12: goods and services rolled up by HSN/SAC.
  const hsnRows = await sql<{
    code: string | null; description: string | null; uqc: string | null;
    qty: string; taxable: string; tax: string;
  }>`
    SELECT l.hsn_sac AS code, h.description, MAX(l.uqc) AS uqc,
           COALESCE(SUM(l.qty), 0) AS qty,
           COALESCE(SUM(l.taxable), 0) AS taxable,
           COALESCE(SUM(l.cgst + l.sgst + l.igst + l.cess), 0) AS tax
      FROM invoice_lines l
      JOIN invoices i ON i.id = l.invoice_id
      LEFT JOIN hsn_codes h ON h.code = l.hsn_sac AND h.org_id = i.org_id
     WHERE i.org_id = ${orgId} AND i.status NOT IN ('draft', 'void')
       AND i.invoice_date BETWEEN ${period.from} AND ${period.to}
       ${branchId ? sql`AND i.branch_id = ${branchId}` : sql``}
     GROUP BY l.hsn_sac, h.description
     ORDER BY taxable DESC
  `.execute(ex);

  const hsn = hsnRows.rows.map((r) => ({
    code: r.code ?? 'UNCLASSIFIED',
    description: r.description,
    uqc: r.uqc ?? 'NOS',
    qty: Number(r.qty),
    taxablePaise: toPaiseFromSql(r.taxable),
    taxPaise: toPaiseFromSql(r.tax),
  }));

  // The checks the portal would otherwise bounce the whole return on.
  const issues: { level: 'error' | 'warning'; message: string }[] = [];

  const missingHsn = hsn.find((h) => h.code === 'UNCLASSIFIED');
  if (missingHsn) {
    issues.push({
      level: 'error',
      message: `Lines worth ₹${(missingHsn.taxablePaise / 100).toLocaleString('en-IN')} have no HSN/SAC code — the portal will reject the return.`,
    });
  }

  const noIrn = b2b.filter((r) => r.irnStatus === 'pending' || r.irnStatus === 'failed').length;
  if (noIrn) {
    issues.push({
      level: 'warning',
      message: `${noIrn} B2B invoice(s) have no IRN. Register them before filing — an invoice without one is not legally valid.`,
    });
  }

  const badGstin = b2b.filter((r) => !r.gstin || r.gstin.length !== 15).length;
  if (badGstin) {
    issues.push({
      level: 'error',
      message: `${badGstin} B2B invoice(s) have a missing or malformed customer GSTIN.`,
    });
  }

  if (cancelled.length) {
    issues.push({
      level: 'warning',
      message: `${cancelled.length} invoice number(s) were cancelled in this period. They are reported in the document summary, not as supplies.`,
    });
  }

  const totals = live.reduce(
    (acc, r) => ({
      taxablePaise: acc.taxablePaise + toPaiseFromSql(r.subtotal),
      cgstPaise: acc.cgstPaise + toPaiseFromSql(r.cgst),
      sgstPaise: acc.sgstPaise + toPaiseFromSql(r.sgst),
      igstPaise: acc.igstPaise + toPaiseFromSql(r.igst),
      cessPaise: acc.cessPaise + toPaiseFromSql(r.cess),
    }),
    { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 },
  );

  const branch = await ex
    .selectFrom('branches')
    .select(['gstin'])
    .where('org_id', '=', orgId)
    .$if(!!branchId, (q) => q.where('id', '=', branchId!))
    .$if(!branchId, (q) => q.where('is_primary', '=', 1))
    .executeTakeFirst();

  return {
    period,
    gstin: branch?.gstin ?? null,
    b2b,
    b2cl,
    b2cs,
    exports,
    creditNotes,
    hsn,
    totals,
    documentSummary: {
      from: issued[0]?.number ?? '—',
      to: issued[issued.length - 1]?.number ?? '—',
      total: issued.length,
      cancelled: cancelled.length,
    },
    issues,
    invoiceCount: live.length,
  };
}

// ── GSTR-3B ──────────────────────────────────────────────────────────────────

export interface Gstr3b {
  period: Period;
  outward: {
    taxablePaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    cessPaise: Paise;
  };
  /** Reverse-charge supplies: we owe the tax on these, not the supplier. */
  inwardRcm: { taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise };
  itc: {
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    /** Credit blocked under section 17(5) — never claimable. */
    blockedPaise: Paise;
  };
  /** What is left to pay in cash after credit is set off. */
  setOff: {
    head: 'IGST' | 'CGST' | 'SGST';
    liabilityPaise: Paise;
    creditUsedPaise: Paise;
    cashPaise: Paise;
  }[];
  totalCashPaise: Paise;
}

/**
 * GSTR-3B: the summary return, and the one you actually pay against.
 *
 * The set-off order is the part worth getting right. IGST credit must be used
 * first, and it can be applied against any head. Only once it is exhausted do
 * CGST and SGST credit come in — and each of those can only offset its own
 * head. Using them in the wrong order leaves credit stranded and cash paid that
 * did not need to be.
 */
export async function gstr3b(ex: Executor, orgId: number, month: string): Promise<Gstr3b> {
  const period = monthRange(month);

  const [outwardRes, rcmRes, itcRes, blockedRes] = await Promise.all([
    sql<{ taxable: string; cgst: string; sgst: string; igst: string; cess: string }>`
      SELECT COALESCE(SUM(subtotal), 0) AS taxable,
             COALESCE(SUM(cgst), 0) AS cgst, COALESCE(SUM(sgst), 0) AS sgst,
             COALESCE(SUM(igst), 0) AS igst, COALESCE(SUM(cess), 0) AS cess
        FROM invoices
       WHERE org_id = ${orgId} AND status NOT IN ('draft', 'void')
         AND invoice_date BETWEEN ${period.from} AND ${period.to}
    `.execute(ex),
    sql<{ taxable: string; cgst: string; sgst: string; igst: string }>`
      SELECT COALESCE(SUM(subtotal), 0) AS taxable,
             COALESCE(SUM(cgst), 0) AS cgst, COALESCE(SUM(sgst), 0) AS sgst,
             COALESCE(SUM(igst), 0) AS igst
        FROM bills
       WHERE org_id = ${orgId} AND status NOT IN ('draft', 'void') AND is_rcm = 1
         AND bill_date BETWEEN ${period.from} AND ${period.to}
    `.execute(ex),
    sql<{ cgst: string; sgst: string; igst: string }>`
      SELECT COALESCE(SUM(bl.cgst), 0) AS cgst,
             COALESCE(SUM(bl.sgst), 0) AS sgst,
             COALESCE(SUM(bl.igst), 0) AS igst
        FROM bill_lines bl
        JOIN bills b ON b.id = bl.bill_id
       WHERE b.org_id = ${orgId} AND b.status NOT IN ('draft', 'void')
         AND bl.itc_eligibility = 'eligible'
         AND b.bill_date BETWEEN ${period.from} AND ${period.to}
    `.execute(ex),
    sql<{ blocked: string }>`
      SELECT COALESCE(SUM(bl.cgst + bl.sgst + bl.igst), 0) AS blocked
        FROM bill_lines bl
        JOIN bills b ON b.id = bl.bill_id
       WHERE b.org_id = ${orgId} AND b.status NOT IN ('draft', 'void')
         AND bl.itc_eligibility <> 'eligible'
         AND b.bill_date BETWEEN ${period.from} AND ${period.to}
    `.execute(ex),
  ]);

  const o = outwardRes.rows[0];
  const r = rcmRes.rows[0];
  const i = itcRes.rows[0];

  const outward = {
    taxablePaise: toPaiseFromSql(o.taxable),
    cgstPaise: toPaiseFromSql(o.cgst),
    sgstPaise: toPaiseFromSql(o.sgst),
    igstPaise: toPaiseFromSql(o.igst),
    cessPaise: toPaiseFromSql(o.cess),
  };

  const inwardRcm = {
    taxablePaise: toPaiseFromSql(r.taxable),
    cgstPaise: toPaiseFromSql(r.cgst),
    sgstPaise: toPaiseFromSql(r.sgst),
    igstPaise: toPaiseFromSql(r.igst),
  };

  // RCM tax is paid in cash and then claimed back as credit in the same return.
  const itc = {
    cgstPaise: toPaiseFromSql(i.cgst) + inwardRcm.cgstPaise,
    sgstPaise: toPaiseFromSql(i.sgst) + inwardRcm.sgstPaise,
    igstPaise: toPaiseFromSql(i.igst) + inwardRcm.igstPaise,
    blockedPaise: toPaiseFromSql(blockedRes.rows[0].blocked),
  };

  // Liability includes the reverse-charge tax we owe on the buy side.
  const liability = {
    IGST: outward.igstPaise + inwardRcm.igstPaise,
    CGST: outward.cgstPaise + inwardRcm.cgstPaise,
    SGST: outward.sgstPaise + inwardRcm.sgstPaise,
  };

  let igstCredit = itc.igstPaise;
  let cgstCredit = itc.cgstPaise;
  let sgstCredit = itc.sgstPaise;

  const setOff: Gstr3b['setOff'] = [];

  // IGST credit first, against IGST, then CGST, then SGST. That order is set by
  // section 49A and is not a preference.
  const igstUsedOnIgst = Math.min(igstCredit, liability.IGST);
  igstCredit -= igstUsedOnIgst;

  const igstUsedOnCgst = Math.min(igstCredit, liability.CGST);
  igstCredit -= igstUsedOnCgst;

  const igstUsedOnSgst = Math.min(igstCredit, liability.SGST);
  igstCredit -= igstUsedOnSgst;

  setOff.push({
    head: 'IGST',
    liabilityPaise: liability.IGST,
    creditUsedPaise: igstUsedOnIgst,
    cashPaise: liability.IGST - igstUsedOnIgst,
  });

  const cgstRemaining = liability.CGST - igstUsedOnCgst;
  const cgstUsed = Math.min(cgstCredit, cgstRemaining);
  cgstCredit -= cgstUsed;
  setOff.push({
    head: 'CGST',
    liabilityPaise: liability.CGST,
    creditUsedPaise: igstUsedOnCgst + cgstUsed,
    cashPaise: cgstRemaining - cgstUsed,
  });

  const sgstRemaining = liability.SGST - igstUsedOnSgst;
  const sgstUsed = Math.min(sgstCredit, sgstRemaining);
  sgstCredit -= sgstUsed;
  setOff.push({
    head: 'SGST',
    liabilityPaise: liability.SGST,
    creditUsedPaise: igstUsedOnSgst + sgstUsed,
    cashPaise: sgstRemaining - sgstUsed,
  });

  return {
    period,
    outward,
    inwardRcm,
    itc,
    setOff,
    totalCashPaise: setOff.reduce((t, s) => t + s.cashPaise, 0),
  };
}
