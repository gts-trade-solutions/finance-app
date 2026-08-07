'use client';

import { useMemo } from 'react';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { RankedReport, type RankedRow } from '@/components/shared/ranked-report';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { toRupees } from '@/lib/money';

export default function PurchasesByVendorPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<RankedRow[]>(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const b of s.bills) {
      if (b.status === 'void') continue;
      if (b.date < range.from || b.date > range.to) continue;
      const cur = map.get(b.vendorId) ?? { amount: 0, count: 0 };
      cur.amount += b.subtotalPaise;
      cur.count += 1;
      map.set(b.vendorId, cur);
    }
    return [...map.entries()]
      .map(([id, v]) => {
        const vendor = s.contacts.find((x) => x.id === id);
        return {
          key: id,
          label: contactName(s, id),
          sublabel: `${v.count} bill${v.count === 1 ? '' : 's'}${vendor?.isMsme ? ' · MSME' : ''}`,
          amountPaise: v.amount,
        };
      })
      .sort((a, b) => b.amountPaise - a.amountPaise);
  }, [s, range]);

  return (
    <ReportShell
      title="Purchases by Vendor"
      description="Spending ranked by supplier, excluding GST. The top of this list is where negotiating better terms pays off most."
      range={range}
      onRangeChange={setRange}
      onExport={() =>
        downloadCsv('purchases-by-vendor.csv', [
          ['Vendor', 'Detail', 'Net purchases'],
          ...rows.map((r) => [r.label, r.sublabel ?? '', toRupees(r.amountPaise)]),
        ])
      }
    >
      <RankedReport rows={rows} labelHeader="Vendor" valueHeader="Net purchases" />
    </ReportShell>
  );
}
