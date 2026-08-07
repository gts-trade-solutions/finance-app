'use client';

import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/shared/money';
import {
  downloadCsv, ReportShell, ReportTable, useReportRange,
} from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { toRupees } from '@/lib/money';

/**
 * Direct-method cash flow: group actual movements through cash/bank accounts by
 * what caused them. Simpler to explain than the indirect method and, for an SMB,
 * more useful — it answers "where did the cash actually come from and go?".
 */
export default function CashFlowPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const flow = useMemo(() => {
    const cashAccountIds = new Set(s.bankAccounts.map((b) => b.ledgerAccountId));
    const groups = new Map<string, { label: string; inflow: number; outflow: number }>();
    let opening = 0;
    let net = 0;

    const LABELS: Record<string, string> = {
      payment_received: 'Collections from customers',
      payment_made: 'Payments to suppliers',
      expense: 'Operating expenses paid',
      retainer: 'Advances received from customers',
      transfer: 'Transfers between own accounts',
      opening: 'Opening cash brought forward',
      manual: 'Other adjustments',
    };

    for (const e of s.entries) {
      const cashLines = e.lines.filter((l) => cashAccountIds.has(l.accountId));
      if (cashLines.length === 0) continue;
      const delta = cashLines.reduce((t, l) => t + l.debit - l.credit, 0);
      if (delta === 0) continue;

      if (e.date < range.from) {
        opening += delta;
        continue;
      }
      if (e.date > range.to) continue;

      net += delta;
      const key = e.sourceType;
      const g = groups.get(key) ?? { label: LABELS[key] ?? key, inflow: 0, outflow: 0 };
      if (delta > 0) g.inflow += delta;
      else g.outflow += -delta;
      groups.set(key, g);
    }

    return {
      opening,
      closing: opening + net,
      net,
      rows: [...groups.values()].sort((a, b) => b.inflow - b.outflow - (a.inflow - a.outflow)),
    };
  }, [s.entries, s.bankAccounts, range]);

  return (
    <ReportShell
      title="Cash Flow"
      description="Profit is an opinion; cash is a fact. This traces every rupee that actually entered or left your bank and cash accounts, grouped by what caused it."
      range={range}
      onRangeChange={setRange}
      onExport={() =>
        downloadCsv('cash-flow.csv', [
          ['Activity', 'Inflow', 'Outflow', 'Net'],
          ...flow.rows.map((r) => [r.label, toRupees(r.inflow), toRupees(r.outflow), toRupees(r.inflow - r.outflow)]),
          ['Opening cash', '', '', toRupees(flow.opening)],
          ['Closing cash', '', '', toRupees(flow.closing)],
        ])
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Opening cash</p>
          <Money value={flow.opening} className="mt-1 block text-2xl font-semibold" />
        </Card>
        <Card className={'p-4 ' + (flow.net >= 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5')}>
          <p className="text-xs text-muted-foreground">Net movement</p>
          <Money value={flow.net} className="mt-1 block text-2xl font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Closing cash</p>
          <Money value={flow.closing} className="mt-1 block text-2xl font-semibold" />
        </Card>
      </div>

      <ReportTable>
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-semibold">Activity</th>
            <th className="px-4 py-2.5 text-right font-semibold">Cash in</th>
            <th className="px-4 py-2.5 text-right font-semibold">Cash out</th>
            <th className="px-4 py-2.5 text-right font-semibold">Net</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b bg-muted/20 font-medium">
            <td className="px-4 py-2.5">Cash at start of period</td>
            <td colSpan={2} />
            <td className="px-4 py-2.5 text-right"><Money value={flow.opening} /></td>
          </tr>
          {flow.rows.map((r) => (
            <tr key={r.label} className="border-b hover:bg-accent/40">
              <td className="px-4 py-2">{r.label}</td>
              <td className="px-4 py-2 text-right"><Money value={r.inflow} showZero={false} /></td>
              <td className="px-4 py-2 text-right"><Money value={r.outflow} showZero={false} /></td>
              <td className="px-4 py-2 text-right font-medium">
                <Money value={r.inflow - r.outflow} colored />
              </td>
            </tr>
          ))}
          <tr className="border-t-2 bg-muted/40 font-semibold">
            <td className="px-4 py-3">Cash at end of period</td>
            <td colSpan={2} />
            <td className="px-4 py-3 text-right"><Money value={flow.closing} /></td>
          </tr>
        </tbody>
      </ReportTable>
    </ReportShell>
  );
}
