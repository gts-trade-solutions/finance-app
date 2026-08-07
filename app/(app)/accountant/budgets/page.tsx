'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { MoneyInput } from '@/components/shared/form-bits';
import { useAppStore } from '@/lib/store';
import { profitAndLoss } from '@/lib/ledger/reports';
import { today } from '@/lib/selectors';
import { ACC } from '@/lib/mock/seed/accounts';

/** Demo budgets — in production these live in a budgets table per account × period. */
const DEFAULT_BUDGETS: Record<string, number> = {
  [ACC.PURCHASES]: 30_00_000_00,
  [ACC.SALARIES]: 9_00_000_00,
  [ACC.RENT]: 3_00_000_00,
  [ACC.FREIGHT]: 1_50_000_00,
  [ACC.MARKETING]: 1_00_000_00,
  [ACC.UTILITIES]: 60_000_00,
  [ACC.FUEL]: 50_000_00,
  [ACC.PROFESSIONAL]: 2_00_000_00,
  [ACC.OFFICE]: 30_000_00,
  [ACC.INTERNET]: 25_000_00,
};

export default function BudgetsPage() {
  const s = useAppStore();
  const [budgets, setBudgets] = useState<Record<string, number>>(DEFAULT_BUDGETS);

  const actuals = useMemo(() => {
    const pl = profitAndLoss(s.accounts, s.entries, {
      from: s.org?.fiscalYearStart ?? '2026-04-01',
      to: today(),
    });
    const map = new Map<string, number>();
    pl.expenseRows.forEach((r) => map.set(r.account.id, r.amount));
    return map;
  }, [s.accounts, s.entries, s.org]);

  const rows = Object.keys(budgets)
    .map((accountId) => {
      const account = s.accounts.find((a) => a.id === accountId);
      const budget = budgets[accountId];
      const actual = actuals.get(accountId) ?? 0;
      return { accountId, account, budget, actual, variance: budget - actual, pct: budget > 0 ? (actual / budget) * 100 : 0 };
    })
    .filter((r) => r.account)
    .sort((a, b) => b.pct - a.pct);

  const totalBudget = rows.reduce((t, r) => t + r.budget, 0);
  const totalActual = rows.reduce((t, r) => t + r.actual, 0);

  return (
    <>
      <PageHeader
        title="Budgets vs actual"
        description="Set a spending plan per account for the year, then watch how reality tracks against it. Actuals come straight from the ledger."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Annual budget</p>
          <Money value={totalBudget} className="mt-1 block text-2xl font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Spent so far</p>
          <Money value={totalActual} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {totalBudget > 0 ? `${((totalActual / totalBudget) * 100).toFixed(0)}% of budget used` : '—'}
          </p>
        </Card>
        <Card className={'p-4 ' + (totalBudget - totalActual >= 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5')}>
          <p className="text-xs text-muted-foreground">Remaining</p>
          <Money value={totalBudget - totalActual} className="mt-1 block text-2xl font-semibold" />
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 text-left font-semibold">Account</th>
                <th className="w-40 px-4 py-2.5 text-right font-semibold">Budget</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actual</th>
                <th className="w-48 px-4 py-2.5 text-left font-semibold">Progress</th>
                <th className="px-4 py-2.5 text-right font-semibold">Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountId} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-muted-foreground">{r.account!.code}</span>{' '}
                    <span className="font-medium">{r.account!.name}</span>
                  </td>
                  <td className="px-4 py-2">
                    <MoneyInput
                      valuePaise={r.budget}
                      onChangePaise={(p) => setBudgets((b) => ({ ...b, [r.accountId]: p }))}
                      className="h-8"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right"><Money value={r.actual} /></td>
                  <td className="px-4 py-2.5">
                    <Progress
                      value={Math.min(100, r.pct)}
                      className={r.pct > 100 ? '[&>div]:bg-red-500' : r.pct > 85 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">{r.pct.toFixed(0)}% used</p>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money value={r.variance} colored className="font-medium" />
                    {r.variance < 0 && (
                      <Badge variant="outline" className="ml-2 border-red-500/40 text-[9px]">Over</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex items-start gap-3 p-4">
        <BarChart3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Edit any budget figure above and the variance recalculates instantly. Actual spend is never typed in — it
          is read from the same journal entries that produce your Profit &amp; Loss, so the two can never disagree.
        </p>
      </Card>
    </>
  );
}
