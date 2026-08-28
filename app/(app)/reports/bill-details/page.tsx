'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { billBalance, contactName } from '@/lib/selectors';
import { StatusBadge } from '@/components/shared/status-badge';
import { toRupees } from '@/lib/money';
import type { Bill } from '@/lib/types';

export default function BillDetailsPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo(
    () =>
      s.bills
        .filter((b) => b.status !== 'void' && b.date >= range.from && b.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.bills, range],
  );

  const columns: GridColumn<Bill>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'number', header: 'Bill#', cell: (r) => <span className="font-medium">{r.internalNo}</span>, csv: (r) => r.internalNo },
    { key: 'vendorRef', header: 'Vendor Invoice#', cell: (r) => <span className="text-xs text-muted-foreground">{r.number}</span>, csv: (r) => r.number },
    { key: 'vendor', header: 'Vendor', cell: (r) => contactName(s, r.vendorId), csv: (r) => contactName(s, r.vendorId) },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, csv: (r) => r.status },
    { key: 'tds', header: 'TDS', align: 'right', cell: (r) => <Money value={r.tdsPaise} showZero={false} />, csv: (r) => toRupees(r.tdsPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.tdsPaise, 0)} /> },
    { key: 'total', header: 'Payable', align: 'right', cell: (r) => <Money value={r.totalPaise} />, csv: (r) => toRupees(r.totalPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.totalPaise, 0)} /> },
    { key: 'balance', header: 'Balance Due', align: 'right', cell: (r) => <Money value={billBalance(r)} showZero={false} />, csv: (r) => toRupees(billBalance(r)), total: (rs) => <Money value={rs.reduce((t, r) => t + billBalance(r), 0)} /> },
  ];

  return (
    <ReportShell
      title="Bill Details"
      description="Every supplier bill in the period, with TDS withheld and what is still owed."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('bill-details.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No bills in this period." />
    </ReportShell>
  );
}
