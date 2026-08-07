// ─────────────────────────────────────────────────────────────────────────────
// GST engine — real logic, not demo filler. Given who is selling from where,
// to whom, delivered where, it decides WHICH GST applies and computes the
// split. This file is production code (reused post-MVP).
// ─────────────────────────────────────────────────────────────────────────────

import type { DocTaxBreakup, GstTreatment, Paise, SupplyType, TaxPref } from '../types';
import { mulQty, pctOf } from '../money';

/** GST state codes (first 2 digits of every GSTIN). '96' = foreign/other territory. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '96': 'Foreign Country',
};

export const GST_RATES = [0, 5, 12, 18, 28] as const;

export function stateName(code: string): string {
  return GST_STATES[code] ?? code;
}

/** Validate GSTIN format + checksum (mod-36). Real algorithm — impresses CAs. */
export function isValidGstin(gstin: string): boolean {
  const re = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  if (!re.test(gstin)) return false;
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(gstin[i]);
    const factor = i % 2 === 0 ? 1 : 2;
    const prod = v * factor;
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return gstin[14] === chars[check];
}

/**
 * The core resolver: what KIND of supply is this?
 *   - supplier branch state vs place of supply → intra (CGST+SGST) / inter (IGST)
 *   - overseas customer → export (LUT = zero-rated, or with tax)
 *   - SEZ customer → treated like export
 */
export function resolveSupplyType(opts: {
  branchStateCode: string;
  placeOfSupply: string; // state code
  customerTreatment: GstTreatment;
  exportWithTax?: boolean;
  taxPref?: TaxPref;
}): SupplyType {
  const { branchStateCode, placeOfSupply, customerTreatment, exportWithTax, taxPref } = opts;
  if (taxPref && taxPref !== 'taxable') return 'nil_or_exempt';
  if (customerTreatment === 'overseas' || placeOfSupply === '96') {
    return exportWithTax ? 'export_with_tax' : 'export_lut';
  }
  if (customerTreatment === 'sez') return 'sez';
  return branchStateCode === placeOfSupply ? 'intra' : 'inter';
}

/** Human label for a supply type — shown live on the invoice form. */
export function supplyTypeLabel(s: SupplyType): string {
  switch (s) {
    case 'intra': return 'Intra-state — CGST + SGST';
    case 'inter': return 'Inter-state — IGST';
    case 'export_lut': return 'Export under LUT — zero-rated';
    case 'export_with_tax': return 'Export with IGST (refund claimable)';
    case 'sez': return 'SEZ supply — zero-rated';
    case 'nil_or_exempt': return 'Nil-rated / Exempt';
  }
}

export const ZERO_TAX: DocTaxBreakup = {
  taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0,
};

/**
 * Compute the tax breakup for one line.
 * IMPORTANT: results are FROZEN onto the document at save time — documents are
 * never recomputed later (historic invoices must print identically forever).
 */
export function computeLineTax(opts: {
  ratePaise: Paise;
  qty: number;
  discountPct: number;
  gstRatePct: number;
  supplyType: SupplyType;
}): { taxable: Paise; tax: DocTaxBreakup; total: Paise } {
  const gross = mulQty(opts.ratePaise, opts.qty);
  const discount = pctOf(gross, opts.discountPct);
  const taxable = gross - discount;

  let cgst = 0, sgst = 0, igst = 0;
  switch (opts.supplyType) {
    case 'intra': {
      // Split evenly; odd paise goes to CGST (deterministic, documented choice)
      const totalTax = pctOf(taxable, opts.gstRatePct);
      sgst = Math.floor(totalTax / 2);
      cgst = totalTax - sgst;
      break;
    }
    case 'inter':
    case 'export_with_tax':
      igst = pctOf(taxable, opts.gstRatePct);
      break;
    case 'export_lut':
    case 'sez':
    case 'nil_or_exempt':
      break; // zero-rated / no tax
  }

  const tax: DocTaxBreakup = {
    taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, cessPaise: 0,
  };
  return { taxable, tax, total: taxable + cgst + sgst + igst };
}

/** Sum per-line breakups into a document-level breakup. */
export function sumTax(parts: DocTaxBreakup[]): DocTaxBreakup {
  return parts.reduce(
    (acc, t) => ({
      taxablePaise: acc.taxablePaise + t.taxablePaise,
      cgstPaise: acc.cgstPaise + t.cgstPaise,
      sgstPaise: acc.sgstPaise + t.sgstPaise,
      igstPaise: acc.igstPaise + t.igstPaise,
      cessPaise: acc.cessPaise + t.cessPaise,
    }),
    { ...ZERO_TAX },
  );
}

export function totalTaxPaise(t: DocTaxBreakup): Paise {
  return t.cgstPaise + t.sgstPaise + t.igstPaise + t.cessPaise;
}

/** TCS 206C(1H): 0.1% on receipts over ₹50L from one buyer in a FY (demo rate). */
export const TCS_RATE_PCT = 0.1;
export const TCS_THRESHOLD_PAISE = 50_00_000_00; // ₹50,00,000 in paise
