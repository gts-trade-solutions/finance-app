'use client';

// Profit and loss: income less expenses over a period.
//
// A period, not a position — that is the whole difference from the balance
// sheet. The same journal answers both questions; only the window changes.

import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, ReportTable, useReportRange } from '@/components/shared/report-shell';
import { AsyncPage, LoadingRows } from '@/components/shared/async-state';
import { reports, type AccountBalanceRow, type ProfitAndLossReport } from '@/lib/api/client';
import { useApi } from '@/lib/api/use-api';
import { toRupees } from '@/lib/money';

function Section({ title, rows, total }: { title: string; rows: AccountBalanceRow[]; total: number }) {
  return (
    <>
      <tr className="bg-muted/40">
        <td className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={2}>
          {title}
        </td>
      </tr>
      {rows.length === 0 ? (
        <tr className="border-b last:border-0">
          <td className="px-4 py-2 text-sm text-muted-foreground" colSpan={2}>
            Nothing in this period.
          </td>
        </tr>
      ) : (
        rows.map((r) => (
          <tr key={r.accountId} className="border-b last:border-0 hover:bg-accent/40">
            <td className="px-4 py-2">
              <span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}
            </td>
            <td className="px-4 py-2 text-right"><Money value={r.balancePaise} /></td>
          </tr>
        ))
      )}
      <tr className="border-b font-medium last:border-0">
        <td className="px-4 py-2">Total {title.toLowerCase()}</td>
        <td className="px-4 py-2 text-right"><Money value={total} /></td>
      </tr>
    </>
  );
}

export default function ProfitAndLossPage() {
  const [range, setRange] = useReportRange();
  const state = useApi<ProfitAndLossReport>(
    () => reports.profitAndLoss(range.from, range.to),
    [range.from, range.to],
  );

  return (
    <ReportShell
      title="Profit and Loss"
      description="Income less expenses over the period. Tax collected on invoices is not income — it is held for the government and sits on the balance sheet."
      range={range}
      onRangeChange={setRange}
      onExport={() => {
        const pl = state.data;
        if (!pl) return;
        downloadCsv('profit-and-loss.csv', [
          ['Section', 'Code', 'Account', 'Amount'],
          ...pl.incomeRows.map((r) => ['Income', r.code, r.name, toRupees(r.balancePaise)]),
          ['', '', 'Total income', toRupees(pl.totalIncome)],
          ...pl.expenseRows.map((r) => ['Expenses', r.code, r.name, toRupees(r.balancePaise)]),
          ['', '', 'Total expenses', toRupees(pl.totalExpense)],
          ['', '', 'Net profit', toRupees(pl.netProfit)],
        ]);
      }}
    >
      <AsyncPage state={state} loading={<LoadingRows rows={10} />}>
        {(pl) => {
          const profitable = pl.netProfit >= 0;
          const margin = pl.totalIncome > 0 ? (pl.netProfit / pl.totalIncome) * 100 : 0;

          return (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: 'Income', value: pl.totalIncome },
                  { label: 'Expenses', value: pl.totalExpense },
                  { label: 'Gross profit', value: pl.grossProfit, hint: 'Income less direct costs' },
                  {
                    label: profitable ? 'Net profit' : 'Net loss',
                    value: Math.abs(pl.netProfit),
                    hint: `${margin.toFixed(1)}% of income`,
                    tone: profitable ? 'good' : 'bad',
                  },
                ].map((t) => (
                  <Card key={t.label} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="micro-label">{t.label}</p>
                        <p
                          className={`mt-1.5 tabular text-2xl font-semibold ${
                            t.tone === 'good'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : t.tone === 'bad'
                                ? 'text-destructive'
                                : ''
                          }`}
                        >
                          <Money value={t.value} />
                        </p>
                        {t.hint && <p className="mt-0.5 text-xs text-muted-foreground">{t.hint}</p>}
                      </div>
                      {t.tone && (
                        profitable
                          ? <TrendingUp className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          : <TrendingDown className="size-4 shrink-0 text-destructive" />
                      )}
                    </div>
                  </Card>
                ))}
              </div>

              <ReportTable>
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-semibold">Account</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <Section title="Income" rows={pl.incomeRows} total={pl.totalIncome} />
                  <Section title="Expenses" rows={pl.expenseRows} total={pl.totalExpense} />
                  <tr className="border-t-2 bg-muted/40 text-base font-semibold">
                    <td className="px-4 py-3">{profitable ? 'Net profit' : 'Net loss'}</td>
                    <td
                      className={`px-4 py-3 text-right ${
                        profitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                      }`}
                    >
                      <Money value={Math.abs(pl.netProfit)} />
                    </td>
                  </tr>
                </tbody>
              </ReportTable>
            </>
          );
        }}
      </AsyncPage>
    </ReportShell>
  );
}
