'use client';

import { useMemo } from 'react';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { RankedReport, type RankedRow } from '@/components/shared/ranked-report';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import { stateName } from '@/lib/tax/gst';

export default function SalesByCustomerPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<RankedRow[]>(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const inv of s.invoices) {
      if (inv.status === 'void' || inv.status === 'draft') continue;
      if (inv.date < range.from || inv.date > range.to) continue;
      const cur = map.get(inv.customerId) ?? { amount: 0, count: 0 };
      cur.amount += inv.subtotalPaise;
      cur.count += 1;
      map.set(inv.customerId, cur);
    }
    return [...map.entries()]
      .map(([id, v]) => {
        const c = s.contacts.find((x) => x.id === id);
        return {
          key: id,
          label: contactName(s, id),
          sublabel: `${v.count} invoice${v.count === 1 ? '' : 's'} · ${stateName(c?.stateCode ?? '')}`,
          amountPaise: v.amount,
        };
      })
      .sort((a, b) => b.amountPaise - a.amountPaise);
  }, [s, range]);

  return (
    <ReportShell
      title="Sales by Customer"
      description="Revenue ranked by who generated it, excluding GST. Useful for spotting concentration risk — if one customer is most of your revenue, that's worth knowing."
      range={range}
      onRangeChange={setRange}
      onExport={() =>
        downloadCsv('sales-by-customer.csv', [
          ['Customer', 'Detail', 'Net sales'],
          ...rows.map((r) => [r.label, r.sublabel ?? '', toRupees(r.amountPaise)]),
        ])
      }
    >
      <RankedReport rows={rows} labelHeader="Customer" valueHeader="Net sales" />
    </ReportShell>
  );
}
