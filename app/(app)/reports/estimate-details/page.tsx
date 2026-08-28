'use client';

// Quote (Estimate) Details — Zoho calls this "Quote Details". Its job is to
// show the top of the funnel: what has been quoted, what was accepted, and what
// quietly expired without anyone following up.

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName, today } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import type { Estimate } from '@/lib/types';

/** Expiry is a fact about the date, not a status somebody remembered to set. */
function effectiveStatus(e: Estimate, asOf: string): Estimate['status'] {
  if (e.status === 'sent' && e.expiryDate < asOf) return 'expired';
  return e.status;
}

export default function EstimateDetailsPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();
  const asOf = today();

  const rows = useMemo(
    () =>
      s.estimates
        .filter((e) => e.status !== 'draft' && e.date >= range.from && e.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.estimates, range],
  );

  const columns: GridColumn<Estimate>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'number', header: 'Quote#', cell: (r) => <span className="font-medium">{r.number}</span>, csv: (r) => r.number },
    { key: 'customer', header: 'Customer', cell: (r) => contactName(s, r.customerId), csv: (r) => contactName(s, r.customerId) },
    { key: 'expiry', header: 'Expiry Date', cell: (r) => <span className="tabular text-xs">{new Date(r.expiryDate).toLocaleDateString('en-IN')}</span>, csv: (r) => r.expiryDate },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={effectiveStatus(r, asOf)} />, csv: (r) => effectiveStatus(r, asOf) },
    {
      key: 'converted',
      header: 'Converted To',
      cell: (r) => {
        if (!r.convertedToId) return <span className="text-xs text-muted-foreground">—</span>;
        const so = s.salesOrders.find((x) => x.id === r.convertedToId);
        const inv = s.invoices.find((x) => x.id === r.convertedToId);
        return <span className="text-xs">{so?.number ?? inv?.number ?? 'Converted'}</span>;
      },
      csv: (r) => {
        if (!r.convertedToId) return '';
        const so = s.salesOrders.find((x) => x.id === r.convertedToId);
        const inv = s.invoices.find((x) => x.id === r.convertedToId);
        return so?.number ?? inv?.number ?? 'Converted';
      },
    },
    {
      key: 'taxable',
      header: 'Taxable',
      align: 'right',
      cell: (r) => <Money value={r.tax.taxablePaise} />,
      csv: (r) => toRupees(r.tax.taxablePaise),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.tax.taxablePaise, 0)} />,
    },
    {
      key: 'total',
      header: 'Quoted Amount',
      align: 'right',
      cell: (r) => <Money value={r.totalPaise} />,
      csv: (r) => toRupees(r.totalPaise),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.totalPaise, 0)} />,
    },
  ];

  const accepted = rows.filter((r) => ['accepted', 'converted'].includes(effectiveStatus(r, asOf)));
  const winRate = rows.length ? (accepted.length / rows.length) * 100 : 0;

  return (
    <ReportShell
      title="Quote Details"
      description="Every quote sent in the period, with what became of it. The conversion rate is the number this report exists for."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('quote-details.csv', gridCsv(rows, columns))}
    >
      <p className="text-xs text-muted-foreground">
        {rows.length} quote(s) sent · {accepted.length} accepted or converted ·{' '}
        <span className="tabular font-medium text-foreground">{winRate.toFixed(1)}%</span> conversion, worth{' '}
        <Money value={accepted.reduce((t, r) => t + r.totalPaise, 0)} className="font-medium" />.
      </p>
      <ReportGrid rows={rows} columns={columns} emptyMessage="No quotes sent in this period." />
    </ReportShell>
  );
}
