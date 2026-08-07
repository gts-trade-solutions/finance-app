'use client';

import { useMemo } from 'react';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { RankedReport, type RankedRow } from '@/components/shared/ranked-report';
import { useAppStore } from '@/lib/store';
import { toRupees } from '@/lib/money';

export default function SalesByItemPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<RankedRow[]>(() => {
    const map = new Map<string, { amount: number; qty: number }>();
    for (const inv of s.invoices) {
      if (inv.status === 'void' || inv.status === 'draft') continue;
      if (inv.date < range.from || inv.date > range.to) continue;
      for (const l of inv.lines) {
        const key = l.itemId ?? l.description;
        const cur = map.get(key) ?? { amount: 0, qty: 0 };
        cur.amount += l.tax.taxablePaise;
        cur.qty += l.qty;
        map.set(key, cur);
      }
    }
    return [...map.entries()]
      .map(([key, v]) => {
        const item = s.items.find((i) => i.id === key);
        return {
          key,
          label: item?.name ?? key,
          sublabel: item ? `${item.sku} · HSN ${item.hsnSac}` : undefined,
          qty: v.qty,
          amountPaise: v.amount,
        };
      })
      .sort((a, b) => b.amountPaise - a.amountPaise);
  }, [s, range]);

  return (
    <ReportShell
      title="Sales by Item"
      description="What actually sells. Quantity and value side by side, so you can see the difference between what moves often and what earns most."
      range={range}
      onRangeChange={setRange}
      onExport={() =>
        downloadCsv('sales-by-item.csv', [
          ['Item', 'Detail', 'Quantity', 'Net sales'],
          ...rows.map((r) => [r.label, r.sublabel ?? '', r.qty ?? 0, toRupees(r.amountPaise)]),
        ])
      }
    >
      <RankedReport rows={rows} labelHeader="Item" valueHeader="Net sales" showQty qtyHeader="Qty sold" />
    </ReportShell>
  );
}
