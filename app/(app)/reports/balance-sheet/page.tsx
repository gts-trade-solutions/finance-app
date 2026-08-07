'use client';

import { useMemo } from 'react';
import { Scale } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/shared/money';
import {
  downloadCsv, ReportShell, ReportTable, useReportRange,
} from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { balanceSheet } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';

export default function BalanceSheetPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();
  const bs = useMemo(
    () => balanceSheet(s.accounts, s.entries, { to: range.to }),
    [s.accounts, s.entries, range.to],
  );

  return (
    <ReportShell
      title="Balance Sheet"
      description="A snapshot of what the business owns and owes on a single date. The two sides always match — that's double-entry doing its job."
      range={range}
      onRangeChange={setRange}
      asOfOnly
      onExport={() =>
        downloadCsv('balance-sheet.csv', [
          ['Section', 'Account', 'Amount'],
          ...bs.assetRows.map((r) => ['Assets', r.account.name, toRupees(r.amount)]),
          ['', 'Total assets', toRupees(bs.totalAssets)],
          ...bs.liabilityRows.map((r) => ['Liabilities', r.account.name, toRupees(r.amount)]),
          ...bs.equityRows.map((r) => ['Equity', r.account.name, toRupees(r.amount)]),
          ['Equity', 'Current period earnings', toRupees(bs.currentEarnings)],
          ['', 'Total liabilities & equity', toRupees(bs.totalLiabEquity)],
        ])
      }
    >
      <Card
        className={
          'flex items-center gap-3 p-4 ' +
          (bs.balanced ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive bg-destructive/5')
        }
      >
        <Scale className={'size-5 shrink-0 ' + (bs.balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')} />
        <div>
          <p className="text-sm font-medium">
            {bs.balanced ? 'Assets equal liabilities plus equity' : 'The sheet does not balance'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Everything the business owns was funded either by borrowing (liabilities) or by the owners (equity) —
            so the totals must agree.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportTable>
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={2}>
                Assets — what we own
              </th>
            </tr>
          </thead>
          <tbody>
            {bs.assetRows.map((r) => (
              <tr key={r.account.id} className="border-b hover:bg-accent/40">
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{r.account.code}</span> {r.account.name}
                </td>
                <td className="px-4 py-2 text-right"><Money value={r.amount} /></td>
              </tr>
            ))}
            <tr className="border-t-2 bg-muted/40 font-semibold">
              <td className="px-4 py-3">Total assets</td>
              <td className="px-4 py-3 text-right"><Money value={bs.totalAssets} /></td>
            </tr>
          </tbody>
        </ReportTable>

        <ReportTable>
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={2}>
                Liabilities & equity — how it was funded
              </th>
            </tr>
          </thead>
          <tbody>
            {bs.liabilityRows.length > 0 && (
              <tr className="border-b bg-muted/20">
                <td className="px-4 py-1.5 text-xs font-medium text-muted-foreground" colSpan={2}>Liabilities</td>
              </tr>
            )}
            {bs.liabilityRows.map((r) => (
              <tr key={r.account.id} className="border-b hover:bg-accent/40">
                <td className="px-4 py-2 pl-6">
                  <span className="font-mono text-xs text-muted-foreground">{r.account.code}</span> {r.account.name}
                </td>
                <td className="px-4 py-2 text-right"><Money value={r.amount} /></td>
              </tr>
            ))}
            <tr className="border-b bg-muted/20">
              <td className="px-4 py-1.5 text-xs font-medium text-muted-foreground" colSpan={2}>Equity</td>
            </tr>
            {bs.equityRows.map((r) => (
              <tr key={r.account.id} className="border-b hover:bg-accent/40">
                <td className="px-4 py-2 pl-6">
                  <span className="font-mono text-xs text-muted-foreground">{r.account.code}</span> {r.account.name}
                </td>
                <td className="px-4 py-2 text-right"><Money value={r.amount} /></td>
              </tr>
            ))}
            <tr className="border-b hover:bg-accent/40">
              <td className="px-4 py-2 pl-6">
                Current period earnings
                <span className="ml-1.5 text-[11px] text-muted-foreground">(profit not yet closed out)</span>
              </td>
              <td className="px-4 py-2 text-right"><Money value={bs.currentEarnings} /></td>
            </tr>
            <tr className="border-t-2 bg-muted/40 font-semibold">
              <td className="px-4 py-3">Total liabilities & equity</td>
              <td className="px-4 py-3 text-right"><Money value={bs.totalLiabEquity} /></td>
            </tr>
          </tbody>
        </ReportTable>
      </div>
    </ReportShell>
  );
}
