'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/shared/money';
import {
  downloadCsv, ReportShell, ReportTable, useReportRange,
} from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { msmeTracker, payablesAgeing } from '@/lib/selectors';
import { AGEING_BUCKETS } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';

export default function ApAgeingPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();
  const rows = useMemo(() => payablesAgeing(s, range.to), [s, range.to]);
  const msmeAtRisk = useMemo(() => msmeTracker(s, range.to).filter((m) => m.risk !== 'ok'), [s, range.to]);

  const totals = AGEING_BUCKETS.map((b) => rows.reduce((t, r) => t + (r.buckets[b] ?? 0), 0));
  const grand = rows.reduce((t, r) => t + r.total, 0);

  return (
    <ReportShell
      title="Payables Ageing"
      description="What you owe suppliers and how overdue it is. Paying late costs relationships — and with MSME vendors, it costs you a tax deduction."
      range={range}
      onRangeChange={setRange}
      asOfOnly
      onExport={() =>
        downloadCsv('ap-ageing.csv', [
          ['Vendor', ...AGEING_BUCKETS, 'Total'],
          ...rows.map((r) => [r.name, ...AGEING_BUCKETS.map((b) => toRupees(r.buckets[b] ?? 0)), toRupees(r.total)]),
          ['TOTAL', ...totals.map(toRupees), toRupees(grand)],
        ])
      }
    >
      {msmeAtRisk.length > 0 && (
        <Link href="/purchases/msme-tracker">
          <Card className="flex items-center gap-3 border-amber-500/40 bg-amber-500/5 p-4 transition-colors hover:bg-amber-500/10">
            <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{msmeAtRisk.length} MSME bill(s) near or past the 45-day limit</p>
              <p className="text-xs text-muted-foreground">
                Section 43B(h) disallows these expenses for income tax until they&apos;re paid. Open the tracker →
              </p>
            </div>
          </Card>
        </Link>
      )}

      <ReportTable>
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-semibold">Vendor</th>
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
                Nothing outstanding — every bill is paid.
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
