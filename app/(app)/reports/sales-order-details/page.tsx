'use client';

// Sales Order Details — orders accepted but not yet fully invoiced. The gap
// between "ordered" and "invoiced" is committed revenue that has not yet been
// billed, which is exactly what gets forgotten at month end.

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import type { SalesOrder } from '@/lib/types';

export default function SalesOrderDetailsPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo(
    () =>
      s.salesOrders
        .filter((o) => o.status !== 'cancelled' && o.date >= range.from && o.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.salesOrders, range],
  );

  const pending = (o: SalesOrder) => Math.max(0, o.totalPaise - o.invoicedPaise);

  const columns: GridColumn<SalesOrder>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'number', header: 'Order#', cell: (r) => <span className="font-medium">{r.number}</span>, csv: (r) => r.number },
    { key: 'customer', header: 'Customer', cell: (r) => contactName(s, r.customerId), csv: (r) => contactName(s, r.customerId) },
    {
      key: 'ship',
      header: 'Expected Ship',
      cell: (r) => (
        <span className="tabular text-xs">
          {r.expectedShipDate ? new Date(r.expectedShipDate).toLocaleDateString('en-IN') : '—'}
        </span>
      ),
      csv: (r) => r.expectedShipDate ?? '',
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, csv: (r) => r.status },
    {
      key: 'total',
      header: 'Order Amount',
      align: 'right',
      cell: (r) => <Money value={r.totalPaise} />,
      csv: (r) => toRupees(r.totalPaise),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.totalPaise, 0)} />,
    },
    {
      key: 'invoiced',
      header: 'Invoiced',
      align: 'right',
      cell: (r) => <Money value={r.invoicedPaise} showZero={false} />,
      csv: (r) => toRupees(r.invoicedPaise),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.invoicedPaise, 0)} />,
    },
    {
      key: 'pending',
      header: 'Yet to Invoice',
      align: 'right',
      cell: (r) => <Money value={pending(r)} showZero={false} />,
      csv: (r) => toRupees(pending(r)),
      total: (rs) => <Money value={rs.reduce((t, r) => t + pending(r), 0)} />,
    },
  ];

  const backlog = rows.reduce((t, r) => t + pending(r), 0);

  return (
    <ReportShell
      title="Sales Order Details"
      description="Confirmed orders and how much of each has been invoiced. What is left is committed revenue you have not yet billed."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('sales-order-details.csv', gridCsv(rows, columns))}
    >
      <p className="text-xs text-muted-foreground">
        {rows.length} order(s) ·{' '}
        <Money value={backlog} className="font-medium" /> still to be invoiced. That amount is not in your
        receivables yet, because no invoice exists for it.
      </p>
      <ReportGrid rows={rows} columns={columns} emptyMessage="No sales orders in this period." />
    </ReportShell>
  );
}
