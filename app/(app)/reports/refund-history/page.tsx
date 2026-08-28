'use client';

// Refund History — money actually returned, in both directions.
//
// A credit note is not a refund. A credit note reduces what a customer owes; a
// refund is cash leaving the bank. Most credits are applied against the next
// invoice and no money ever moves. This report shows only the ones where it
// did, which is what an auditor asks for and what the bank statement will show.

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Row {
  id: string;
  direction: 'out' | 'in';
  date: string;
  number: string;
  party: string;
  reason: string;
  against: string;
  amount: number;
}

export default function RefundHistoryPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];

    // Refunds we paid out — a customer credit settled in cash rather than
    // applied against a later invoice.
    for (const cn of s.creditNotes) {
      if (cn.status !== 'refunded') continue;
      if (cn.date < range.from || cn.date > range.to) continue;
      const inv = s.invoices.find((i) => i.id === cn.againstInvoiceId);
      out.push({
        id: cn.id,
        direction: 'out',
        date: cn.date,
        number: cn.number,
        party: contactName(s, cn.customerId),
        reason: cn.reason,
        against: inv?.number ?? '—',
        amount: cn.totalPaise - cn.appliedPaise,
      });
    }

    // Refunds we received — a supplier returning money on a vendor credit.
    for (const vc of s.vendorCredits) {
      if (vc.status !== 'refunded') continue;
      if (vc.date < range.from || vc.date > range.to) continue;
      const bill = s.bills.find((b) => b.id === vc.againstBillId);
      out.push({
        id: vc.id,
        direction: 'in',
        date: vc.date,
        number: vc.number,
        party: contactName(s, vc.vendorId),
        reason: vc.reason,
        against: bill?.number ?? '—',
        amount: vc.totalPaise - vc.appliedPaise,
      });
    }

    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [s, range]);

  const columns: GridColumn<Row>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    {
      key: 'direction',
      header: 'Direction',
      cell: (r) => (
        <Badge
          variant="outline"
          className={cn(
            'text-[10px]',
            r.direction === 'out' ? 'border-destructive/40 text-destructive' : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
          )}
        >
          {r.direction === 'out' ? 'Refunded to customer' : 'Received from vendor'}
        </Badge>
      ),
      csv: (r) => (r.direction === 'out' ? 'Refunded to customer' : 'Received from vendor'),
    },
    { key: 'number', header: 'Credit#', cell: (r) => <span className="font-medium">{r.number}</span>, csv: (r) => r.number },
    { key: 'party', header: 'Party', cell: (r) => r.party, csv: (r) => r.party },
    { key: 'against', header: 'Against', cell: (r) => <span className="text-xs text-muted-foreground">{r.against}</span>, csv: (r) => r.against },
    { key: 'reason', header: 'Reason', cell: (r) => <span className="text-xs text-muted-foreground">{r.reason}</span>, csv: (r) => r.reason },
    {
      key: 'amount',
      header: 'Refunded',
      align: 'right',
      cell: (r) => <Money value={r.amount} />,
      csv: (r) => toRupees(r.amount),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.amount, 0)} />,
    },
  ];

  const outward = rows.filter((r) => r.direction === 'out').reduce((t, r) => t + r.amount, 0);
  const inward = rows.filter((r) => r.direction === 'in').reduce((t, r) => t + r.amount, 0);

  return (
    <ReportShell
      title="Refund History"
      description="Credits that were settled in cash rather than applied — the only ones where money actually moved."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('refund-history.csv', gridCsv(rows, columns))}
    >
      <p className="text-xs text-muted-foreground">
        <Money value={outward} className="font-medium" /> refunded to customers ·{' '}
        <Money value={inward} className="font-medium" /> received back from suppliers. Credit notes that were
        applied against a later document are not refunds and do not appear here — see{' '}
        <span className="text-foreground">Credit Note Details</span> for those.
      </p>
      <ReportGrid
        rows={rows}
        columns={columns}
        emptyMessage="No refunds in this period. Credits were applied against later documents instead."
      />
    </ReportShell>
  );
}
