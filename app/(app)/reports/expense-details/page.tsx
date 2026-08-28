'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { totalTaxPaise } from '@/lib/tax/gst';
import type { Expense } from '@/lib/types';

export default function ExpenseDetailsPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo(
    () =>
      s.expenses
        .filter((e) => e.status !== 'void' && e.date >= range.from && e.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.expenses, range],
  );

  const columns: GridColumn<Expense>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'number', header: 'Expense#', cell: (r) => <span className="font-medium">{r.number}</span>, csv: (r) => r.number },
    { key: 'account', header: 'Category', cell: (r) => s.accounts.find((a) => a.id === r.accountId)?.name ?? '—', csv: (r) => s.accounts.find((a) => a.id === r.accountId)?.name ?? '' },
    { key: 'vendor', header: 'Vendor', cell: (r) => (r.vendorId ? contactName(s, r.vendorId) : '—'), csv: (r) => (r.vendorId ? contactName(s, r.vendorId) : '') },
    { key: 'notes', header: 'Description', cell: (r) => <span className="text-xs text-muted-foreground">{r.notes}</span>, csv: (r) => r.notes },
    { key: 'billable', header: 'Billable', align: 'center', cell: (r) => (r.isBillable ? <Badge variant="outline" className="text-[9px]">Billable</Badge> : <span className="text-xs text-muted-foreground">—</span>), csv: (r) => (r.isBillable ? 'Yes' : 'No') },
    { key: 'itc', header: 'Input Credit', align: 'right', cell: (r) => <Money value={totalTaxPaise(r.tax)} showZero={false} />, csv: (r) => toRupees(totalTaxPaise(r.tax)), total: (rs) => <Money value={rs.reduce((t, r) => t + totalTaxPaise(r.tax), 0)} /> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amountPaise} className="font-medium" />, csv: (r) => toRupees(r.amountPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.amountPaise, 0)} /> },
  ];

  return (
    <ReportShell
      title="Expense Details"
      description="Every expense line in the period, with the input credit claimed on it."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('expense-details.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No expenses in this period." />
    </ReportShell>
  );
}
