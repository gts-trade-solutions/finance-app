'use client';

import { useMemo } from 'react';
import { Money } from '@/components/shared/money';
import { downloadCsv, ReportShell, useReportRange } from '@/components/shared/report-shell';
import { ReportGrid, gridCsv, type GridColumn } from '@/components/shared/report-grid';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { toRupees } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import type { Payment } from '@/lib/types';

export default function PaymentsMadeReportPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo(
    () =>
      s.payments
        .filter((p) => p.kind === 'made' && p.status !== 'void' && p.date >= range.from && p.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.payments, range],
  );

  const columns: GridColumn<Payment>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'number', header: 'Payment#', cell: (r) => <span className="font-medium">{r.number}</span>, csv: (r) => r.number },
    { key: 'vendor', header: 'Vendor', cell: (r) => contactName(s, r.contactId), csv: (r) => contactName(s, r.contactId) },
    { key: 'mode', header: 'Mode', cell: (r) => <Badge variant="secondary" className="uppercase text-[10px]">{r.mode}</Badge>, csv: (r) => r.mode },
    { key: 'account', header: 'Paid From', cell: (r) => <span className="text-xs">{s.bankAccounts.find((b) => b.id === r.bankAccountId)?.name ?? '—'}</span>, csv: (r) => s.bankAccounts.find((b) => b.id === r.bankAccountId)?.name ?? '' },
    { key: 'bills', header: 'Bills', align: 'center', cell: (r) => <span className="tabular text-xs">{r.allocations.length}</span>, csv: (r) => r.allocations.length },
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amountPaise} className="font-medium" />, csv: (r) => toRupees(r.amountPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.amountPaise, 0)} /> },
  ];

  return (
    <ReportShell
      title="Payments Made"
      description="Every payment to suppliers in the period, and which account it left from."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('payments-made.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No vendor payments in this period." />
    </ReportShell>
  );
}
