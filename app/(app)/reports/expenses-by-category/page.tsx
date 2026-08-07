'use client';

import { useMemo } from 'react';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { RankedReport, type RankedRow } from '@/components/shared/ranked-report';
import { useAppStore } from '@/lib/store';
import { profitAndLoss } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';

export default function ExpensesByCategoryPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<RankedRow[]>(() => {
    const pl = profitAndLoss(s.accounts, s.entries, range);
    return pl.expenseRows.map((r) => ({
      key: r.account.id,
      label: r.account.name,
      sublabel: `Account ${r.account.code}`,
      amountPaise: r.amount,
    }));
  }, [s.accounts, s.entries, range]);

  return (
    <ReportShell
      title="Expenses by Category"
      description="Where the money goes, taken straight from the expense accounts in your chart of accounts."
      range={range}
      onRangeChange={setRange}
      onExport={() =>
        downloadCsv('expenses-by-category.csv', [
          ['Category', 'Account code', 'Amount'],
          ...rows.map((r) => [r.label, r.sublabel ?? '', toRupees(r.amountPaise)]),
        ])
      }
    >
      <RankedReport rows={rows} labelHeader="Category" valueHeader="Amount" />
    </ReportShell>
  );
}
