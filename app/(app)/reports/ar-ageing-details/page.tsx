'use client';

// AR Ageing Details — the invoice-by-invoice version of the ageing summary.
// The summary tells you a customer owes ₹4L across the 31–45 bucket; this tells
// you *which* invoice it is, so somebody can actually go and chase it.

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName, invoiceBalance, openInvoices, today } from '@/lib/selectors';
import { ageingBucket } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';
import type { Invoice } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Row {
  invoice: Invoice;
  customer: string;
  age: number;
  bucket: string;
  balance: number;
}

export default function ArAgeingDetailsPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<Row[]>(() => {
    const asOf = today();
    return openInvoices(s)
      .filter((i) => i.date >= range.from && i.date <= range.to)
      .map((invoice) => ({
        invoice,
        customer: contactName(s, invoice.customerId),
        // Age runs from the due date, not the invoice date — an invoice on
        // 60-day terms is not "60 days old" the moment credit is granted.
        age: Math.floor((new Date(asOf).getTime() - new Date(invoice.dueDate).getTime()) / 86_400_000),
        bucket: ageingBucket(invoice.dueDate, asOf),
        balance: invoiceBalance(invoice),
      }))
      .sort((a, b) => b.age - a.age);
  }, [s, range]);

  const columns: GridColumn<Row>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (r) => <span className="tabular text-xs">{new Date(r.invoice.date).toLocaleDateString('en-IN')}</span>,
      csv: (r) => r.invoice.date,
    },
    { key: 'number', header: 'Invoice#', cell: (r) => <span className="font-medium">{r.invoice.number}</span>, csv: (r) => r.invoice.number },
    { key: 'customer', header: 'Customer', cell: (r) => r.customer, csv: (r) => r.customer },
    {
      key: 'due',
      header: 'Due Date',
      cell: (r) => <span className="tabular text-xs">{new Date(r.invoice.dueDate).toLocaleDateString('en-IN')}</span>,
      csv: (r) => r.invoice.dueDate,
    },
    {
      key: 'age',
      header: 'Age (days)',
      align: 'right',
      cell: (r) => (
        <span className={cn('tabular text-xs', r.age > 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          {r.age > 0 ? r.age : '—'}
        </span>
      ),
      csv: (r) => (r.age > 0 ? r.age : 0),
    },
    {
      key: 'bucket',
      header: 'Bucket',
      cell: (r) => (
        <Badge variant="outline" className={cn('text-[10px]', r.bucket !== 'Current' && 'border-destructive/40 text-destructive')}>
          {r.bucket}
        </Badge>
      ),
      csv: (r) => r.bucket,
    },
    {
      key: 'total',
      header: 'Invoice Total',
      align: 'right',
      cell: (r) => <Money value={r.invoice.totalPaise} />,
      csv: (r) => toRupees(r.invoice.totalPaise),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.invoice.totalPaise, 0)} />,
    },
    {
      key: 'balance',
      header: 'Balance Due',
      align: 'right',
      cell: (r) => <Money value={r.balance} />,
      csv: (r) => toRupees(r.balance),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.balance, 0)} />,
    },
  ];

  const overdue = rows.filter((r) => r.age > 0);

  return (
    <ReportShell
      title="AR Ageing Details"
      description="Every unpaid invoice, aged from its due date. The summary tells you how much is late; this tells you which invoice to chase."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('ar-ageing-details.csv', gridCsv(rows, columns))}
    >
      <p className="text-xs text-muted-foreground">
        {rows.length} open invoice(s), of which {overdue.length} are past due — {' '}
        <Money value={overdue.reduce((t, r) => t + r.balance, 0)} className="font-medium" /> overdue.
      </p>
      <ReportGrid rows={rows} columns={columns} emptyMessage="Nothing outstanding in this period." />
    </ReportShell>
  );
}
