'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { invoiceBalance } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import { stateName } from '@/lib/tax/gst';
import type { Paise } from '@/lib/types';

interface Row {
  id: string;
  name: string;
  state: string;
  gstin: string;
  invoiced: Paise;
  received: Paise;
  balance: Paise;
}

export default function CustomerBalancesPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<Row[]>(() => {
    return s.contacts
      .filter((c) => !c.isArchived && (c.kind === 'customer' || c.kind === 'both'))
      .map((c) => {
        const invs = s.invoices.filter(
          (i) => i.customerId === c.id && i.status !== 'void' && i.status !== 'draft' && i.date <= range.to,
        );
        const invoiced = invs.reduce((t, i) => t + i.totalPaise, 0);
        const balance = invs.reduce((t, i) => t + invoiceBalance(i), 0);
        return {
          id: c.id,
          name: c.displayName,
          state: stateName(c.stateCode),
          gstin: c.gstin ?? '—',
          invoiced,
          received: invoiced - balance,
          balance,
        };
      })
      .filter((r) => r.invoiced !== 0 || r.balance !== 0)
      .sort((a, b) => b.balance - a.balance);
  }, [s, range.to]);

  const columns: GridColumn<Row>[] = [
    { key: 'name', header: 'Customer', cell: (r) => <span className="font-medium">{r.name}</span>, csv: (r) => r.name },
    { key: 'gstin', header: 'GSTIN', cell: (r) => <span className="font-mono text-xs">{r.gstin}</span>, csv: (r) => r.gstin },
    { key: 'state', header: 'State', cell: (r) => r.state, csv: (r) => r.state },
    { key: 'invoiced', header: 'Invoiced', align: 'right', cell: (r) => <Money value={r.invoiced} />, csv: (r) => toRupees(r.invoiced), total: (rs) => <Money value={rs.reduce((t, r) => t + r.invoiced, 0)} /> },
    { key: 'received', header: 'Received', align: 'right', cell: (r) => <Money value={r.received} />, csv: (r) => toRupees(r.received), total: (rs) => <Money value={rs.reduce((t, r) => t + r.received, 0)} /> },
    { key: 'balance', header: 'Closing Balance', align: 'right', cell: (r) => <Money value={r.balance} className={r.balance > 0 ? 'font-medium' : 'text-muted-foreground'} />, csv: (r) => toRupees(r.balance), total: (rs) => <Money value={rs.reduce((t, r) => t + r.balance, 0)} /> },
  ];

  return (
    <ReportShell
      title="Customer Balances"
      description="What each customer has been invoiced, what they have paid, and what is still outstanding."
      range={range}
      onRangeChange={setRange}
      asOfOnly
      onExport={() => downloadCsv('customer-balances.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No customer activity yet." />
    </ReportShell>
  );
}
