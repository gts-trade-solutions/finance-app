'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { accountNets, isDebitNormal } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';
import type { AccountType, Paise } from '@/lib/types';

interface Row {
  type: AccountType;
  label: string;
  accounts: number;
  debit: Paise;
  credit: Paise;
  net: Paise;
}

const LABEL: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
};

const ORDER: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export default function AccountTypeSummaryPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<Row[]>(() => {
    const nets = accountNets(s.entries, { to: range.to });
    return ORDER.map((type) => {
      const accounts = s.accounts.filter((a) => a.type === type);
      let debit = 0;
      let credit = 0;
      let touched = 0;
      for (const a of accounts) {
        const n = nets.get(a.id) ?? 0;
        if (n === 0) continue;
        touched += 1;
        if (n > 0) debit += n;
        else credit += -n;
      }
      const raw = debit - credit;
      return {
        type,
        label: LABEL[type],
        accounts: touched,
        debit,
        credit,
        // Show each family in its natural direction, so nothing reads negative
        // just because it is credit-normal.
        net: isDebitNormal(type) ? raw : -raw,
      };
    }).filter((r) => r.accounts > 0);
  }, [s.accounts, s.entries, range.to]);

  const columns: GridColumn<Row>[] = [
    { key: 'label', header: 'Account Type', cell: (r) => <span className="font-medium">{r.label}</span>, csv: (r) => r.label },
    { key: 'accounts', header: 'Accounts with Activity', align: 'right', cell: (r) => <span className="tabular">{r.accounts}</span>, csv: (r) => r.accounts, total: (rs) => <span className="tabular">{rs.reduce((t, r) => t + r.accounts, 0)}</span> },
    { key: 'debit', header: 'Total Debit', align: 'right', cell: (r) => <Money value={r.debit} showZero={false} />, csv: (r) => toRupees(r.debit), total: (rs) => <Money value={rs.reduce((t, r) => t + r.debit, 0)} /> },
    { key: 'credit', header: 'Total Credit', align: 'right', cell: (r) => <Money value={r.credit} showZero={false} />, csv: (r) => toRupees(r.credit), total: (rs) => <Money value={rs.reduce((t, r) => t + r.credit, 0)} /> },
    { key: 'net', header: 'Closing Balance', align: 'right', cell: (r) => <Money value={r.net} className="font-medium" />, csv: (r) => toRupees(r.net) },
  ];

  return (
    <ReportShell
      title="Account Type Summary"
      description="The five account families at a glance. Balances are shown in each family's natural direction, so nothing looks negative merely because it is credit-normal."
      range={range}
      onRangeChange={setRange}
      asOfOnly
      onExport={() => downloadCsv('account-type-summary.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No account activity yet." />
    </ReportShell>
  );
}
