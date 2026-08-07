'use client';

import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/shared/money';
import {
  downloadCsv, ReportShell, ReportTable, useReportRange,
} from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { profitAndLoss } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';

export default function ProfitAndLossPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();
  const pl = useMemo(
    () => profitAndLoss(s.accounts, s.entries, range),
    [s.accounts, s.entries, range],
  );

  const margin = pl.totalIncome > 0 ? (pl.netProfit / pl.totalIncome) * 100 : 0;

  return (
    <ReportShell
      title="Profit & Loss"
      description="Income earned minus expenses incurred over the period. This answers the single question every owner asks: did we make money?"
      range={range}
      onRangeChange={setRange}
      onExport={() =>
        downloadCsv('profit-and-loss.csv', [
          ['Section', 'Account', 'Amount'],
          ...pl.incomeRows.map((r) => ['Income', r.account.name, toRupees(r.amount)]),
          ['', 'Total income', toRupees(pl.totalIncome)],
          ...pl.expenseRows.map((r) => ['Expense', r.account.name, toRupees(r.amount)]),
          ['', 'Total expenses', toRupees(pl.totalExpense)],
          ['', 'Net profit', toRupees(pl.netProfit)],
        ])
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total income</p>
          <Money value={pl.totalIncome} className="mt-1 block text-2xl font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total expenses</p>
          <Money value={pl.totalExpense} className="mt-1 block text-2xl font-semibold" />
        </Card>
        <Card className={'p-4 ' + (pl.netProfit >= 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5')}>
          <p className="text-xs text-muted-foreground">{pl.netProfit >= 0 ? 'Net profit' : 'Net loss'}</p>
          <Money value={Math.abs(pl.netProfit)} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-0.5 text-xs text-muted-foreground">{margin.toFixed(1)}% margin</p>
        </Card>
      </div>

      <ReportTable>
        <tbody>
          <tr className="border-b bg-muted/50">
            <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={2}>
              Income
            </td>
          </tr>
          {pl.incomeRows.map((r) => (
            <tr key={r.account.id} className="border-b hover:bg-accent/40">
              <td className="px-4 py-2 pl-8">
                <span className="font-mono text-xs text-muted-foreground">{r.account.code}</span>{' '}
                {r.account.name}
              </td>
              <td className="px-4 py-2 text-right"><Money value={r.amount} /></td>
            </tr>
          ))}
          <tr className="border-b bg-muted/20 font-medium">
            <td className="px-4 py-2.5">Total income</td>
            <td className="px-4 py-2.5 text-right"><Money value={pl.totalIncome} /></td>
          </tr>

          <tr className="border-b bg-muted/50">
            <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={2}>
              Expenses
            </td>
          </tr>
          {pl.expenseRows.map((r) => (
            <tr key={r.account.id} className="border-b hover:bg-accent/40">
              <td className="px-4 py-2 pl-8">
                <span className="font-mono text-xs text-muted-foreground">{r.account.code}</span>{' '}
                {r.account.name}
              </td>
              <td className="px-4 py-2 text-right"><Money value={r.amount} /></td>
            </tr>
          ))}
          <tr className="border-b bg-muted/20 font-medium">
            <td className="px-4 py-2.5">Total expenses</td>
            <td className="px-4 py-2.5 text-right"><Money value={pl.totalExpense} /></td>
          </tr>

          <tr className="border-t-2 bg-muted/40 text-base font-semibold">
            <td className="px-4 py-3">{pl.netProfit >= 0 ? 'Net profit' : 'Net loss'}</td>
            <td className="px-4 py-3 text-right"><Money value={pl.netProfit} /></td>
          </tr>
        </tbody>
      </ReportTable>
    </ReportShell>
  );
}
