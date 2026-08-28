'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import Link from 'next/link';
import { toRupees } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import type { Paise } from '@/lib/types';

const SOURCE_ROUTE: Record<string, string> = {
  invoice: '/sales/invoices',
  bill: '/purchases/bills',
};

interface Row {
  entryId: string;
  entryNo: number;
  date: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  memo: string;
  sourceType: string;
  sourceId: string | null;
  debit: Paise;
  credit: Paise;
}

export default function AccountTransactionsPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const e of s.entries) {
      if (e.date < range.from || e.date > range.to) continue;
      for (const l of e.lines) {
        const acc = s.accounts.find((a) => a.id === l.accountId);
        out.push({
          entryId: e.id,
          entryNo: e.entryNo,
          date: e.date,
          accountCode: acc?.code ?? '',
          accountName: acc?.name ?? 'Unknown account',
          accountType: acc?.type ?? '',
          memo: l.description ?? e.memo,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
          debit: l.debit,
          credit: l.credit,
        });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.entryNo - a.entryNo);
  }, [s.entries, s.accounts, range]);

  const columns: GridColumn<Row>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'je', header: 'JE#', cell: (r) => <span className="tabular text-xs text-muted-foreground">#{r.entryNo}</span>, csv: (r) => r.entryNo },
    { key: 'account', header: 'Account', cell: (r) => (<span><span className="tabular text-xs text-muted-foreground">{r.accountCode}</span>{' '}<span className="font-medium">{r.accountName}</span></span>), csv: (r) => `${r.accountCode} ${r.accountName}` },
    { key: 'type', header: 'Type', cell: (r) => <span className="text-xs capitalize text-muted-foreground">{r.accountType}</span>, csv: (r) => r.accountType },
    { key: 'memo', header: 'Narration', cell: (r) => <span className="text-xs">{r.memo}</span>, csv: (r) => r.memo },
    {
      key: 'source',
      header: 'Source',
      cell: (r) =>
        r.sourceId && SOURCE_ROUTE[r.sourceType] ? (
          <Link href={`${SOURCE_ROUTE[r.sourceType]}/${r.sourceId}`} className="text-xs capitalize text-primary hover:underline">
            {r.sourceType.replace('_', ' ')} ↗
          </Link>
        ) : (
          <Badge variant="secondary" className="text-[9px] capitalize">{r.sourceType.replace('_', ' ')}</Badge>
        ),
      csv: (r) => r.sourceType,
    },
    { key: 'debit', header: 'Debit', align: 'right', cell: (r) => (r.debit ? <Money value={r.debit} /> : <span className="text-muted-foreground">—</span>), csv: (r) => toRupees(r.debit), total: (rs) => <Money value={rs.reduce((t, r) => t + r.debit, 0)} /> },
    { key: 'credit', header: 'Credit', align: 'right', cell: (r) => (r.credit ? <Money value={r.credit} /> : <span className="text-muted-foreground">—</span>), csv: (r) => toRupees(r.credit), total: (rs) => <Money value={rs.reduce((t, r) => t + r.credit, 0)} /> },
  ];

  return (
    <ReportShell
      title="Account Transactions"
      description="Every journal line in the period, across every account. This is the widest view of the books — the raw material behind every other report."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('account-transactions.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No transactions in this period." />
    </ReportShell>
  );
}
