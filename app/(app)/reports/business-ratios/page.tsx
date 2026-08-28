'use client';

import { useMemo } from 'react';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { Card } from '@/components/ui/card';
import { balanceSheet, profitAndLoss } from '@/lib/ledger/reports';
import { openInvoices, totalPayable, totalReceivable } from '@/lib/selectors';
import { ACC } from '@/lib/mock/seed/accounts';
import { cn } from '@/lib/utils';

interface Ratio {
  group: string;
  name: string;
  value: string;
  meaning: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

const TONE: Record<Ratio['tone'], string> = {
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive',
  neutral: 'text-foreground',
};

export default function BusinessRatiosPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const ratios = useMemo<Ratio[]>(() => {
    const pl = profitAndLoss(s.accounts, s.entries, range);
    const bs = balanceSheet(s.accounts, s.entries, { to: range.to });
    const nets = new Map(bs.assetRows.map((r) => [r.account.id, r.amount]));

    const receivable = totalReceivable(s);
    const payable = totalPayable(s);
    const cash = s.bankAccounts.reduce(
      (t, b) => t + (bs.assetRows.find((r) => r.account.id === b.ledgerAccountId)?.amount ?? 0),
      0,
    );
    const currentAssets = cash + receivable + (nets.get(ACC.INVENTORY) ?? 0);
    const days = Math.max(
      1,
      Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000),
    );

    const pct = (n: number) => `${n.toFixed(1)}%`;
    const x = (n: number) => `${n.toFixed(2)}×`;

    const margin = pl.totalIncome > 0 ? (pl.netProfit / pl.totalIncome) * 100 : 0;
    const currentRatio = payable > 0 ? currentAssets / payable : 0;
    const quick = payable > 0 ? (cash + receivable) / payable : 0;
    const dso = pl.totalIncome > 0 ? (receivable / pl.totalIncome) * days : 0;
    const dpo = pl.totalExpense > 0 ? (payable / pl.totalExpense) * days : 0;
    const expenseRatio = pl.totalIncome > 0 ? (pl.totalExpense / pl.totalIncome) * 100 : 0;

    return [
      { group: 'Profitability', name: 'Net profit margin', value: pct(margin), meaning: 'Of every ₹100 you invoice, this much is profit after all costs.', tone: margin >= 10 ? 'good' : margin >= 0 ? 'warn' : 'bad' },
      { group: 'Profitability', name: 'Expense ratio', value: pct(expenseRatio), meaning: 'Share of income consumed by expenses. Below 90% leaves room to breathe.', tone: expenseRatio <= 90 ? 'good' : 'warn' },
      { group: 'Liquidity', name: 'Current ratio', value: currentRatio ? x(currentRatio) : '—', meaning: 'Short-term assets against short-term dues. Under 1× means you cannot cover what is owed.', tone: currentRatio >= 1.5 ? 'good' : currentRatio >= 1 ? 'warn' : 'bad' },
      { group: 'Liquidity', name: 'Quick ratio', value: quick ? x(quick) : '—', meaning: 'The same test, ignoring stock — because stock is not cash until it sells.', tone: quick >= 1 ? 'good' : 'warn' },
      { group: 'Working capital', name: 'Days sales outstanding', value: `${Math.round(dso)} days`, meaning: 'Average time customers take to pay. Lower is better for cash flow.', tone: dso <= 45 ? 'good' : dso <= 60 ? 'warn' : 'bad' },
      { group: 'Working capital', name: 'Days payable outstanding', value: `${Math.round(dpo)} days`, meaning: 'Average time you take to pay suppliers. Beyond 45 days risks the MSME rule.', tone: dpo <= 45 ? 'good' : 'warn' },
      { group: 'Working capital', name: 'Open invoices', value: String(openInvoices(s).length), meaning: 'Invoices still awaiting payment.', tone: 'neutral' },
    ];
  }, [s, range]);

  const groups = useMemo(() => {
    const m = new Map<string, Ratio[]>();
    for (const r of ratios) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return [...m.entries()];
  }, [ratios]);

  return (
    <ReportShell
      title="Business Performance Ratios"
      description="The handful of numbers a lender or an accountant checks first. Each is explained in plain terms, because a ratio you cannot interpret is not information."
      range={range}
      onRangeChange={setRange}
      onExport={() =>
        downloadCsv('business-ratios.csv', [
          ['Group', 'Ratio', 'Value', 'What it means'],
          ...ratios.map((r) => [r.group, r.name, r.value, r.meaning]),
        ])
      }
    >
      {groups.map(([group, items]) => (
        <section key={group} className="space-y-3">
          <h2 className="micro-label">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((r) => (
              <Card key={r.name} className="accent-bar p-4">
                <p className="text-[13px] text-muted-foreground">{r.name}</p>
                <p className={cn('mt-1 text-2xl font-semibold tabular', TONE[r.tone])}>{r.value}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{r.meaning}</p>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </ReportShell>
  );
}
