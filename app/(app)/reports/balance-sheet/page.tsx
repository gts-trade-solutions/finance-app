'use client';

// What the business owns and owes on a single date.
//
// The piece people miss is current period earnings. Profit made this year has
// not been moved into retained earnings yet, but it belongs to the owners all
// the same — leave it out and the sheet fails to balance by exactly the year's
// profit, which is a very confusing way to discover it.

import { Scale } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, ReportTable, useReportRange } from '@/components/shared/report-shell';
import { AsyncPage, LoadingRows } from '@/components/shared/async-state';
import { reports, type AccountBalanceRow, type BalanceSheetReport } from '@/lib/api/client';
import { useApi } from '@/lib/api/use-api';
import { toRupees } from '@/lib/money';

function Group({
  title,
  rows,
  total,
  extra,
}: {
  title: string;
  rows: AccountBalanceRow[];
  total: number;
  extra?: { label: string; value: number; hint: string };
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b bg-muted/40 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 && !extra && (
            <tr>
              <td className="px-4 py-3 text-sm text-muted-foreground" colSpan={2}>Nothing here.</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.accountId} className="border-b last:border-0">
              <td className="px-4 py-2">
                <span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}
              </td>
              <td className="px-4 py-2 text-right"><Money value={r.balancePaise} /></td>
            </tr>
          ))}
          {extra && (
            <tr className="border-b last:border-0">
              <td className="px-4 py-2">
                {extra.label}
                <span className="mt-0.5 block text-xs text-muted-foreground">{extra.hint}</span>
              </td>
              <td className="px-4 py-2 text-right"><Money value={extra.value} /></td>
            </tr>
          )}
          <tr className="border-t-2 bg-muted/30 font-semibold">
            <td className="px-4 py-2.5">Total {title.toLowerCase()}</td>
            <td className="px-4 py-2.5 text-right"><Money value={total} /></td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

export default function BalanceSheetPage() {
  const [range, setRange] = useReportRange();
  const state = useApi<BalanceSheetReport>(() => reports.balanceSheet(range.to), [range.to]);

  return (
    <ReportShell
      title="Balance Sheet"
      description="What the business owns and owes on a single date. Assets must equal liabilities plus equity."
      range={range}
      onRangeChange={setRange}
      asOfOnly
      onExport={() => {
        const bs = state.data;
        if (!bs) return;
        downloadCsv('balance-sheet.csv', [
          ['Section', 'Code', 'Account', 'Amount'],
          ...bs.assetRows.map((r) => ['Assets', r.code, r.name, toRupees(r.balancePaise)]),
          ['', '', 'Total assets', toRupees(bs.totalAssets)],
          ...bs.liabilityRows.map((r) => ['Liabilities', r.code, r.name, toRupees(r.balancePaise)]),
          ['', '', 'Total liabilities', toRupees(bs.totalLiabilities)],
          ...bs.equityRows.map((r) => ['Equity', r.code, r.name, toRupees(r.balancePaise)]),
          ['Equity', '', 'Current period earnings', toRupees(bs.currentPeriodEarnings)],
          ['', '', 'Total equity', toRupees(bs.totalEquity)],
        ]);
      }}
    >
      <AsyncPage state={state} loading={<LoadingRows rows={10} />}>
        {(bs) => (
          <>
            <Card
              className={
                'flex items-center gap-3 p-4 ' +
                (bs.balanced ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive bg-destructive/5')
              }
            >
              <Scale
                className={
                  'size-5 shrink-0 ' +
                  (bs.balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')
                }
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {bs.balanced
                    ? 'Assets equal liabilities plus equity'
                    : 'The sheet does NOT balance — investigate immediately'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <Money value={bs.totalAssets} /> in assets against{' '}
                  <Money value={bs.totalLiabilities} /> owed and <Money value={bs.totalEquity} /> of equity.
                </p>
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Group title="Assets" rows={bs.assetRows} total={bs.totalAssets} />
              <div className="space-y-4">
                <Group title="Liabilities" rows={bs.liabilityRows} total={bs.totalLiabilities} />
                <Group
                  title="Equity"
                  rows={bs.equityRows}
                  total={bs.totalEquity}
                  extra={{
                    label: 'Current period earnings',
                    value: bs.currentPeriodEarnings,
                    hint: 'Profit made this year, not yet moved to retained earnings',
                  }}
                />
              </div>
            </div>

            <ReportTable>
              <tbody>
                <tr className="text-base font-semibold">
                  <td className="px-4 py-3">Assets</td>
                  <td className="px-4 py-3 text-right"><Money value={bs.totalAssets} /></td>
                  <td className="px-4 py-3 text-center text-muted-foreground">=</td>
                  <td className="px-4 py-3">Liabilities + equity</td>
                  <td className="px-4 py-3 text-right">
                    <Money value={bs.totalLiabilities + bs.totalEquity} />
                  </td>
                </tr>
              </tbody>
            </ReportTable>
          </>
        )}
      </AsyncPage>
    </ReportShell>
  );
}
