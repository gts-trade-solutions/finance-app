'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import {
  downloadCsv, ReportShell, ReportTable, useReportRange,
} from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { receivablesAgeing } from '@/lib/selectors';
import { AGEING_BUCKETS } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';

export default function ArAgeingPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();
  const rows = useMemo(() => receivablesAgeing(s, range.to), [s, range.to]);

  const totals = AGEING_BUCKETS.map((b) => rows.reduce((t, r) => t + (r.buckets[b] ?? 0), 0));
  const grand = rows.reduce((t, r) => t + r.total, 0);
  const overdue = totals.slice(1).reduce((t, v) => t + v, 0);

  return (
    <ReportShell
      title="Receivables Ageing"
      description="Who owes you money and how long they've been sitting on it. The further right a figure appears, the harder it usually gets to collect."
      range={range}
      onRangeChange={setRange}
      asOfOnly
      onExport={() =>
        downloadCsv('ar-ageing.csv', [
          ['Customer', ...AGEING_BUCKETS, 'Total'],
          ...rows.map((r) => [r.name, ...AGEING_BUCKETS.map((b) => toRupees(r.buckets[b] ?? 0)), toRupees(r.total)]),
          ['TOTAL', ...totals.map(toRupees), toRupees(grand)],
        ])
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Total outstanding</p>
          <Money value={grand} className="mt-1 block text-2xl font-semibold" />
        </div>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-xs text-muted-foreground">Past due</p>
          <Money value={overdue} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {grand > 0 ? `${((overdue / grand) * 100).toFixed(0)}% of receivables` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4">
          <p className="text-xs text-muted-foreground">Over 60 days</p>
          <Money value={totals[5]} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-0.5 text-xs text-muted-foreground">Chase these first</p>
        </div>
      </div>

      <ReportTable>
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-semibold">Customer</th>
            {AGEING_BUCKETS.map((b) => (
              <th key={b} className="px-4 py-2.5 text-right font-semibold">{b}</th>
            ))}
            <th className="px-4 py-2.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nothing outstanding — every invoice is settled.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.contactId} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-4 py-2 font-medium">{r.name}</td>
                {AGEING_BUCKETS.map((b, i) => (
                  <td key={b} className="px-4 py-2 text-right">
                    <Money
                      value={r.buckets[b] ?? 0}
                      showZero={false}
                      className={i >= 4 && (r.buckets[b] ?? 0) > 0 ? 'text-destructive' : undefined}
                    />
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-medium"><Money value={r.total} /></td>
              </tr>
            ))
          )}
          {rows.length > 0 && (
            <tr className="border-t-2 bg-muted/40 font-semibold">
              <td className="px-4 py-3">Total</td>
              {totals.map((t, i) => (
                <td key={i} className="px-4 py-3 text-right"><Money value={t} showZero={false} /></td>
              ))}
              <td className="px-4 py-3 text-right"><Money value={grand} /></td>
            </tr>
          )}
        </tbody>
      </ReportTable>
    </ReportShell>
  );
}
