'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { billBalance } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import { stateName } from '@/lib/tax/gst';
import { Badge } from '@/components/ui/badge';
import type { Paise } from '@/lib/types';

interface Row {
  id: string;
  name: string;
  gstin: string;
  state: string;
  isMsme: boolean;
  billed: Paise;
  paid: Paise;
  balance: Paise;
}

export default function VendorBalancesPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo<Row[]>(() => {
    return s.contacts
      .filter((c) => !c.isArchived && (c.kind === 'vendor' || c.kind === 'both'))
      .map((c) => {
        const bills = s.bills.filter((b) => b.vendorId === c.id && b.status !== 'void' && b.date <= range.to);
        const billed = bills.reduce((t, b) => t + b.totalPaise, 0);
        const balance = bills.reduce((t, b) => t + billBalance(b), 0);
        return {
          id: c.id,
          name: c.displayName,
          gstin: c.gstin ?? '—',
          state: stateName(c.stateCode),
          isMsme: c.isMsme,
          billed,
          paid: billed - balance,
          balance,
        };
      })
      .filter((r) => r.billed !== 0 || r.balance !== 0)
      .sort((a, b) => b.balance - a.balance);
  }, [s, range.to]);

  const columns: GridColumn<Row>[] = [
    {
      key: 'name',
      header: 'Vendor',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{r.name}</span>
          {r.isMsme && <Badge variant="outline" className="text-[9px]">MSME</Badge>}
        </span>
      ),
      csv: (r) => r.name + (r.isMsme ? ' (MSME)' : ''),
    },
    { key: 'gstin', header: 'GSTIN', cell: (r) => <span className="font-mono text-xs">{r.gstin}</span>, csv: (r) => r.gstin },
    { key: 'state', header: 'State', cell: (r) => r.state, csv: (r) => r.state },
    { key: 'billed', header: 'Billed', align: 'right', cell: (r) => <Money value={r.billed} />, csv: (r) => toRupees(r.billed), total: (rs) => <Money value={rs.reduce((t, r) => t + r.billed, 0)} /> },
    { key: 'paid', header: 'Paid', align: 'right', cell: (r) => <Money value={r.paid} />, csv: (r) => toRupees(r.paid), total: (rs) => <Money value={rs.reduce((t, r) => t + r.paid, 0)} /> },
    { key: 'balance', header: 'Closing Balance', align: 'right', cell: (r) => <Money value={r.balance} className={r.balance > 0 ? 'font-medium' : 'text-muted-foreground'} />, csv: (r) => toRupees(r.balance), total: (rs) => <Money value={rs.reduce((t, r) => t + r.balance, 0)} /> },
  ];

  return (
    <ReportShell
      title="Vendor Balances"
      description="What each supplier has billed you, what you have paid, and what is still owed."
      range={range}
      onRangeChange={setRange}
      asOfOnly
      onExport={() => downloadCsv('vendor-balances.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No vendor activity yet." />
    </ReportShell>
  );
}
