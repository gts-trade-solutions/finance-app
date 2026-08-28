'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { accountNets, profitAndLoss } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';
import type { Paise } from '@/lib/types';

interface Row { label: string; note: string; amount: Paise; emphasis?: boolean }

export default function MovementOfEquityPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<Row[]>(() => {
    const opening = accountNets(s.entries, { to: range.from });
    const closing = accountNets(s.entries, { to: range.to });
    const equityAccounts = s.accounts.filter((a) => a.type === 'equity');

    const openingEquity = equityAccounts.reduce((t, a) => t + -(opening.get(a.id) ?? 0), 0);
    const closingEquity = equityAccounts.reduce((t, a) => t + -(closing.get(a.id) ?? 0), 0);
    const contributions = closingEquity - openingEquity;
    const pl = profitAndLoss(s.accounts, s.entries, range);

    return [
      { label: 'Opening equity', note: `Owners' stake at ${new Date(range.from).toLocaleDateString('en-IN')}`, amount: openingEquity },
      { label: 'Capital introduced / withdrawn', note: 'Money the owners put in or took out during the period', amount: contributions },
      { label: pl.netProfit >= 0 ? 'Profit for the period' : 'Loss for the period', note: 'Earned by the business, not contributed by the owners', amount: pl.netProfit },
      { label: 'Closing equity', note: `Owners' stake at ${new Date(range.to).toLocaleDateString('en-IN')}`, amount: openingEquity + contributions + pl.netProfit, emphasis: true },
    ];
  }, [s.accounts, s.entries, range]);

  const columns: GridColumn<Row>[] = [
    {
      key: 'label',
      header: 'Particulars',
      cell: (r) => (
        <span>
          <span className={r.emphasis ? 'font-semibold' : 'font-medium'}>{r.label}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{r.note}</span>
        </span>
      ),
      csv: (r) => r.label,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (r) => <Money value={r.amount} colored={!r.emphasis} className={r.emphasis ? 'text-base font-semibold' : 'font-medium'} />,
      csv: (r) => toRupees(r.amount),
    },
  ];

  return (
    <ReportShell
      title="Movement of Equity"
      description="How the owners' stake changed over the period, separating money they put in from profit the business earned."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('movement-of-equity.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} showTotals={false} />
    </ReportShell>
  );
}
