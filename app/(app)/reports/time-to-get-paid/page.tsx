'use client';

// Time to Get Paid.
//
// Ageing tells you what is late right now. This tells you how long you *usually*
// wait, which is a different and more useful question — it is the number that
// says whether your 30-day terms mean anything in practice. Only fully settled
// invoices count, because a half-paid invoice has no payment date yet.

import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import type { Invoice } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Row {
  invoice: Invoice;
  customer: string;
  settledOn: string;
  /** Calendar days from invoice date to the payment that cleared the balance. */
  days: number;
  /** Days past the agreed due date. Negative means paid early. */
  vsTerms: number;
}

const days = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

export default function TimeToGetPaidPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const invoice of s.invoices) {
      if (invoice.status === 'void' || invoice.status === 'draft') continue;
      if (invoice.date < range.from || invoice.date > range.to) continue;
      if (invoice.amountPaidPaise < invoice.totalPaise) continue; // not settled yet

      // The settling date is the LAST receipt allocated to this invoice —
      // part payments before it do not end the wait.
      const dates = s.payments
        .filter(
          (p) =>
            p.kind === 'received' &&
            p.status !== 'void' &&
            p.allocations.some((a) => a.targetType === 'invoice' && a.targetId === invoice.id),
        )
        .map((p) => p.date)
        .sort();
      const settledOn = dates[dates.length - 1];
      if (!settledOn) continue; // settled by a credit note, not cash

      out.push({
        invoice,
        customer: contactName(s, invoice.customerId),
        settledOn,
        days: Math.max(0, days(invoice.date, settledOn)),
        vsTerms: days(invoice.dueDate, settledOn),
      });
    }
    return out.sort((a, b) => b.days - a.days);
  }, [s, range]);

  const avg = rows.length ? rows.reduce((t, r) => t + r.days, 0) / rows.length : 0;
  const onTime = rows.filter((r) => r.vsTerms <= 0).length;
  const fastest = rows.length ? Math.min(...rows.map((r) => r.days)) : 0;
  const slowest = rows.length ? Math.max(...rows.map((r) => r.days)) : 0;

  const columns: GridColumn<Row>[] = [
    { key: 'number', header: 'Invoice#', cell: (r) => <span className="font-medium">{r.invoice.number}</span>, csv: (r) => r.invoice.number },
    { key: 'customer', header: 'Customer', cell: (r) => r.customer, csv: (r) => r.customer },
    { key: 'date', header: 'Invoice Date', cell: (r) => <span className="tabular text-xs">{new Date(r.invoice.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.invoice.date },
    { key: 'due', header: 'Due Date', cell: (r) => <span className="tabular text-xs">{new Date(r.invoice.dueDate).toLocaleDateString('en-IN')}</span>, csv: (r) => r.invoice.dueDate },
    { key: 'settled', header: 'Paid On', cell: (r) => <span className="tabular text-xs">{new Date(r.settledOn).toLocaleDateString('en-IN')}</span>, csv: (r) => r.settledOn },
    {
      key: 'days',
      header: 'Days Taken',
      align: 'right',
      cell: (r) => <span className="tabular text-xs font-medium">{r.days}</span>,
      csv: (r) => r.days,
    },
    {
      key: 'vsTerms',
      header: 'Vs Terms',
      align: 'right',
      cell: (r) => (
        <Badge
          variant="outline"
          className={cn(
            'text-[10px]',
            r.vsTerms > 0 ? 'border-destructive/40 text-destructive' : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
          )}
        >
          {r.vsTerms > 0 ? `${r.vsTerms} late` : r.vsTerms === 0 ? 'On time' : `${Math.abs(r.vsTerms)} early`}
        </Badge>
      ),
      csv: (r) => r.vsTerms,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (r) => <Money value={r.invoice.totalPaise} />,
      csv: (r) => toRupees(r.invoice.totalPaise),
      total: (rs) => <Money value={rs.reduce((t, r) => t + r.invoice.totalPaise, 0)} />,
    },
  ];

  return (
    <ReportShell
      title="Time to Get Paid"
      description="How long invoices actually take to settle, measured from the invoice date to the receipt that cleared them."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('time-to-get-paid.csv', gridCsv(rows, columns))}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Average days to pay', value: rows.length ? avg.toFixed(1) : '—', hint: 'across settled invoices' },
          { label: 'Paid on time', value: rows.length ? `${((onTime / rows.length) * 100).toFixed(0)}%` : '—', hint: `${onTime} of ${rows.length}` },
          { label: 'Fastest', value: rows.length ? `${fastest} days` : '—', hint: 'best case' },
          { label: 'Slowest', value: rows.length ? `${slowest} days` : '—', hint: 'worst case' },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <p className="micro-label">{k.label}</p>
            <p className="mt-1.5 tabular text-2xl font-semibold">{k.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{k.hint}</p>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Only fully settled invoices appear — a partly paid invoice has no payment date yet, so including it would
        drag the average down with a wait that has not finished. Invoices cleared by a credit note rather than
        cash are excluded for the same reason: no money changed hands.
      </p>

      <ReportGrid rows={rows} columns={columns} emptyMessage="No invoices were fully settled in this period." />
    </ReportShell>
  );
}
