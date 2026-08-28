'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName, effectiveInvoiceStatus, invoiceBalance } from '@/lib/selectors';
import { StatusBadge } from '@/components/shared/status-badge';
import { toRupees } from '@/lib/money';
import type { Invoice } from '@/lib/types';

export default function InvoiceDetailsPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo(
    () =>
      s.invoices
        .filter((i) => i.status !== 'draft' && i.date >= range.from && i.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.invoices, range],
  );

  const columns: GridColumn<Invoice>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'number', header: 'Invoice#', cell: (r) => <span className="font-medium">{r.number}</span>, csv: (r) => r.number },
    { key: 'customer', header: 'Customer', cell: (r) => contactName(s, r.customerId), csv: (r) => contactName(s, r.customerId) },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={effectiveInvoiceStatus(r)} />, csv: (r) => effectiveInvoiceStatus(r) },
    { key: 'due', header: 'Due Date', cell: (r) => <span className="tabular text-xs">{new Date(r.dueDate).toLocaleDateString('en-IN')}</span>, csv: (r) => r.dueDate },
    { key: 'taxable', header: 'Taxable', align: 'right', cell: (r) => <Money value={r.subtotalPaise} />, csv: (r) => toRupees(r.subtotalPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.subtotalPaise, 0)} /> },
    { key: 'total', header: 'Total', align: 'right', cell: (r) => <Money value={r.totalPaise} />, csv: (r) => toRupees(r.totalPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.totalPaise, 0)} /> },
    { key: 'balance', header: 'Balance Due', align: 'right', cell: (r) => <Money value={invoiceBalance(r)} showZero={false} />, csv: (r) => toRupees(invoiceBalance(r)), total: (rs) => <Money value={rs.reduce((t, r) => t + invoiceBalance(r), 0)} /> },
  ];

  return (
    <ReportShell
      title="Invoice Details"
      description="Every invoice raised in the period, with its status and outstanding balance."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('invoice-details.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No invoices in this period." />
    </ReportShell>
  );
}
