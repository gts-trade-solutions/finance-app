'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { StatusBadge } from '@/components/shared/status-badge';
import { toRupees } from '@/lib/money';
import type { CreditNote } from '@/lib/types';

export default function CreditNoteDetailsPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo(
    () =>
      s.creditNotes
        .filter((c) => c.status !== 'void' && c.date >= range.from && c.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.creditNotes, range],
  );

  const columns: GridColumn<CreditNote>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'number', header: 'Credit Note#', cell: (r) => <span className="font-medium">{r.number}</span>, csv: (r) => r.number },
    { key: 'customer', header: 'Customer', cell: (r) => contactName(s, r.customerId), csv: (r) => contactName(s, r.customerId) },
    { key: 'against', header: 'Against Invoice', cell: (r) => <span className="text-xs">{s.invoices.find((i) => i.id === r.againstInvoiceId)?.number ?? 'Standalone'}</span>, csv: (r) => s.invoices.find((i) => i.id === r.againstInvoiceId)?.number ?? 'Standalone' },
    { key: 'reason', header: 'Reason', cell: (r) => <span className="text-xs text-muted-foreground">{r.reason}</span>, csv: (r) => r.reason },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, csv: (r) => r.status },
    { key: 'taxable', header: 'Taxable', align: 'right', cell: (r) => <Money value={r.tax.taxablePaise} />, csv: (r) => toRupees(r.tax.taxablePaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.tax.taxablePaise, 0)} /> },
    { key: 'total', header: 'Total', align: 'right', cell: (r) => <Money value={r.totalPaise} className="font-medium" />, csv: (r) => toRupees(r.totalPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.totalPaise, 0)} /> },
  ];

  return (
    <ReportShell
      title="Credit Note Details"
      description="Credits issued to customers, why they were issued, and which invoice they relate to. GST law requires a reason on every one."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('credit-note-details.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No credit notes in this period." />
    </ReportShell>
  );
}
