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

export default function PaymentsReceivedReportPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const rows = useMemo(
    () =>
      s.payments
        .filter((p) => p.kind === 'received' && p.status !== 'void' && p.date >= range.from && p.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.payments, range],
  );

  const columns: GridColumn<Payment>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>, csv: (r) => r.date },
    { key: 'number', header: 'Payment#', cell: (r) => <span className="font-medium">{r.number}</span>, csv: (r) => r.number },
    { key: 'customer', header: 'Customer', cell: (r) => contactName(s, r.contactId), csv: (r) => contactName(s, r.contactId) },
    { key: 'mode', header: 'Mode', cell: (r) => <Badge variant="secondary" className="uppercase text-[10px]">{r.mode}</Badge>, csv: (r) => r.mode },
    { key: 'ref', header: 'Reference', cell: (r) => <span className="text-xs text-muted-foreground">{r.reference || '—'}</span>, csv: (r) => r.reference },
    { key: 'tds', header: 'TDS Withheld', align: 'right', cell: (r) => <Money value={r.tdsPaise} showZero={false} />, csv: (r) => toRupees(r.tdsPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.tdsPaise, 0)} /> },
    { key: 'unapplied', header: 'On Account', align: 'right', cell: (r) => <Money value={r.unappliedPaise} showZero={false} />, csv: (r) => toRupees(r.unappliedPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.unappliedPaise, 0)} /> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amountPaise} className="font-medium" />, csv: (r) => toRupees(r.amountPaise), total: (rs) => <Money value={rs.reduce((t, r) => t + r.amountPaise, 0)} /> },
  ];

  return (
    <ReportShell
      title="Payments Received"
      description="Every customer receipt in the period, including tax they withheld and any amount still sitting on account."
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadCsv('payments-received.csv', gridCsv(rows, columns))}
    >
      <ReportGrid rows={rows} columns={columns} emptyMessage="No receipts in this period." />
    </ReportShell>
  );
}
