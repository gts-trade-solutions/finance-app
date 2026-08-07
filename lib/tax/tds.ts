// ─────────────────────────────────────────────────────────────────────────────
// TDS engine — section master + threshold logic. When paying vendors, the law
// requires withholding tax once per-FY (or single-payment) thresholds breach.
// The accumulator lives in the store; this module is the pure logic.
// ─────────────────────────────────────────────────────────────────────────────

import type { Paise, TdsSection } from '../types';

/** Common sections with FY 2026-27 demo rates/thresholds (verify with CA before production). */
export const TDS_SECTIONS: TdsSection[] = [
  {
    code: '194C',
    description: 'Payments to contractors',
    ratePctWithPan: 2,
    ratePctWithoutPan: 20,
    thresholdSinglePaise: 30_000_00,
    thresholdAnnualPaise: 1_00_000_00,
  },
  {
    code: '194J',
    description: 'Professional / technical fees',
    ratePctWithPan: 10,
    ratePctWithoutPan: 20,
    thresholdSinglePaise: 30_000_00,
    thresholdAnnualPaise: 30_000_00,
  },
  {
    code: '194H',
    description: 'Commission / brokerage',
    ratePctWithPan: 5,
    ratePctWithoutPan: 20,
    thresholdSinglePaise: 15_000_00,
    thresholdAnnualPaise: 15_000_00,
  },
  {
    code: '194I',
    description: 'Rent (land/building)',
    ratePctWithPan: 10,
    ratePctWithoutPan: 20,
    thresholdSinglePaise: 2_40_000_00,
    thresholdAnnualPaise: 2_40_000_00,
  },
  {
    code: '194Q',
    description: 'Purchase of goods',
    ratePctWithPan: 0.1,
    ratePctWithoutPan: 5,
    thresholdSinglePaise: 50_00_000_00,
    thresholdAnnualPaise: 50_00_000_00,
  },
];

export function tdsSection(code: string): TdsSection | undefined {
  return TDS_SECTIONS.find((s) => s.code === code);
}

/**
 * Decide TDS for a bill.
 * @param billTaxable  taxable value of this bill (TDS is on the base, not GST)
 * @param fyPaidSoFar  gross paid/billed to this vendor this FY before this bill
 */
export function computeTds(opts: {
  sectionCode: string | undefined;
  hasPan: boolean;
  billTaxable: Paise;
  fyPaidSoFar: Paise;
  lowerRatePct?: number; // lower-deduction certificate override
}): { applies: boolean; ratePct: number; tdsPaise: Paise; reason: string } {
  const sec = opts.sectionCode ? tdsSection(opts.sectionCode) : undefined;
  if (!sec) return { applies: false, ratePct: 0, tdsPaise: 0, reason: 'No TDS section mapped' };

  const crossesSingle = opts.billTaxable >= sec.thresholdSinglePaise;
  const crossesAnnual = opts.fyPaidSoFar + opts.billTaxable >= sec.thresholdAnnualPaise;
  if (!crossesSingle && !crossesAnnual) {
    return {
      applies: false,
      ratePct: 0,
      tdsPaise: 0,
      reason: `Below ${sec.code} thresholds (single ₹${sec.thresholdSinglePaise / 100}, annual ₹${sec.thresholdAnnualPaise / 100})`,
    };
  }

  const ratePct =
    opts.lowerRatePct ?? (opts.hasPan ? sec.ratePctWithPan : sec.ratePctWithoutPan);
  const tdsPaise = Math.round((opts.billTaxable * ratePct) / 100);
  const why = crossesSingle ? 'single-payment threshold' : 'annual threshold';
  const panNote = opts.hasPan ? '' : ' (no PAN → 20%)';
  return {
    applies: true,
    ratePct,
    tdsPaise,
    reason: `${sec.code} @ ${ratePct}% — ${why} crossed${panNote}`,
  };
}
