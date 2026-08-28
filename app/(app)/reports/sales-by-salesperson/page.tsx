'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { toRupees } from '@/lib/money';
import type { Paise } from '@/lib/types';

interface Row {
  id: string;
  name: string;
  role: string;
  invoices: number;
  sales: Paise;
  collected: Paise;
  outstanding: Paise;
}

export default function SalesBySalespersonPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<Row[]>(() => {
    const inRange = s.invoices.filter(
      (i) => i.status !== 'void' && i.status !== 'draft' && i.date >= range.from && i.date <= range.to,
    );
    const buckets = new Map<string, Row>();
    for (const inv of inRange) {
      const id = inv.salespersonId ?? '_none';
      const user = s.users.find((u) => u.id === id);
      const row = buckets.get(id) ?? {
        id,
        name: user?.name ?? 'Unassigned',
        role: user?.role ?? '—',
        invoices: 0,
        sales: 0,
        collected: 0,
        outstanding: 0,
      };
      row.invoices += 1;
      row.sales += inv.subtotalPaise;
      row.collected += inv.amountPaidPaise;
      row.outstanding += inv.totalPaise - inv.amountPaidPaise;
      buckets.set(id, row);
    }
    return [...buckets.values()].sort((a, b) => b.sales - a.sales);
  }, [s, range]);

  const columns: GridColumn<Row>[] = [
    { key: 'name', header: 'Salesperson', cell: (r) => <span className="font-medium">{r.name}</span>, csv: (r) => r.name },
    { key: 'role', header: 'Role', cell: (r) => <span className="text-xs capitalize text-muted-foreground">{r.role}</span>, csv: (r) => r.role },
    { key: 'invoices', header: 'Invoices', align: 'right', cell: (r) => <span className="tabular">{r.invoices}</span>, csv: (r) => r.invoices, total: (rs) => <span className="tabular">{rs.reduce((t, r) => t + r.invoices, 0)}</span> },
    { key: 'sales', header: 'Net Sales', align: 'right', cell: (r) => <Money value={r.sales} className="font-medium" />, csv: (r) => toRupees(r.sales), total: (rs) => <Money value={rs.reduce((t, r) => t + r.sales, 0)} /> },
    { key: 'collected', header: 'Collected', align: 'right', cell: (r) => <Money value={r.collected} />, csv: (r) => toRupees(r.collected), total: (rs) => <Money value={rs.reduce((t, r) => t + r.collected, 0)} /> },
    { key: 'outstanding', header: 'Outstanding', align: 'right', cell: (r) => <Money value={r.outstanding} />, csv: (r) => toRupees(r.outstanding), total: (rs) => <Money value={rs.reduce((t, r) => t + r.outstanding, 0)} /> },
  ];

  return (
    <ReportShell
      title="Sales by Salesperson"
      description="Who booked the revenue, and how much of it they have actually collected. Invoices with no salesperson are grouped as Unassigned."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('sales-by-salesperson.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No sales in this period." />
    </ReportShell>
  );
}
