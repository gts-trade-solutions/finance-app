'use client';

// Retainer Invoice Details.
//
// A retainer is money taken before any work is done, so it is a *liability*,
// not income — you owe the customer either the service or the money back. This
// report is how you see what is still owed in that sense: collected, less what
// has been applied against real invoices.

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import type { RetainerInvoice } from '@/lib/types';

export default function RetainerDetailsPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo(
    () =>
      s.retainers
        .filter((r) => r.status !== 'draft' && r.status !== 'void' && r.date >= range.from && r.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.retainers, range],
  );

  const unapplied = (r: RetainerInvoice) => Math.max(0, r.amountPaise - r.appliedPaise);

  const columns: GridColumn<RetainerInvoice>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'number', header: 'Retainer#', cell: (r) => <span className="font-medium">{r.number}</span>, csv: (r) => r.number },
    { key: 'customer', header: 'Customer', cell: (r) => contactName(s, r.customerId), csv: (r) => contactName(s, r.customerId) },
    { key: 'description', header: 'For', cell: (r) => <span className="text-xs text-muted-foreground">{r.description}</span>, csv: (r) => r.description },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, csv: (r) => r.status },
    {
      key: 'amount',
      header: 'Collected',
      align: 'right',
      cell: (r) => <Money value={r.amountPaise} />,
      csv: (r) => toRupees(r.amountPaise),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.amountPaise, 0)} />,
    },
    {
      key: 'applied',
      header: 'Applied',
      align: 'right',
      cell: (r) => <Money value={r.appliedPaise} showZero={false} />,
      csv: (r) => toRupees(r.appliedPaise),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.appliedPaise, 0)} />,
    },
    {
      key: 'unapplied',
      header: 'Still Held',
      align: 'right',
      cell: (r) => <Money value={unapplied(r)} showZero={false} />,
      csv: (r) => toRupees(unapplied(r)),
      total: (rs) => <Money value={rs.reduce((t, r) => t + unapplied(r), 0)} />,
    },
  ];

  const held = rows.reduce((t, r) => t + unapplied(r), 0);

  return (
    <ReportShell
      title="Retainer Invoice Details"
      description="Advances taken from customers, and how much of each is still unearned."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('retainer-details.csv', gridCsv(rows, columns))}
    >
      <p className="text-xs text-muted-foreground">
        <Money value={held} className="font-medium" /> is still held against future work. It sits in Unearned
        Revenue on the balance sheet — a liability — and only becomes income when a real invoice draws it down.
      </p>
      <ReportGrid rows={rows} columns={columns} emptyMessage="No retainers raised in this period." />
    </ReportShell>
  );
}
