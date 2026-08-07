'use client';

import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/shared/money';
import {
  downloadCsv, ReportShell, ReportTable, useReportRange,
} from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { trialBalance } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';

export default function TrialBalancePage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();
  const tb = useMemo(() => trialBalance(s.accounts, s.entries, { to: range.to }), [s.accounts, s.entries, range.to]);

  return (
    <ReportShell
      title="Trial Balance"
      description="Every account's closing position. If the two columns don't match to the paisa, something is wrong — this is the books proving themselves."
      range={range}
      onRangeChange={setRange}
      asOfOnly
      onExport={() =>
        downloadCsv('trial-balance.csv', [
          ['Code', 'Account', 'Type', 'Debit', 'Credit'],
          ...tb.rows.map((r) => [r.code, r.name, r.type, toRupees(r.debit), toRupees(r.credit)]),
          ['', 'TOTAL', '', toRupees(tb.totalDebit), toRupees(tb.totalCredit)],
        ])
      }
    >
      <Card
        className={
          'flex items-center gap-3 p-4 ' +
          (tb.balanced ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive bg-destructive/5')
        }
      >
        <CheckCircle2 className={'size-5 shrink-0 ' + (tb.balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {tb.balanced ? 'The books balance' : 'The books do NOT balance — investigate immediately'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {tb.rows.length} accounts with movement · total debits <Money value={tb.totalDebit} /> ·
            total credits <Money value={tb.totalCredit} />
          </p>
        </div>
      </Card>

      <ReportTable>
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-semibold">Code</th>
            <th className="px-4 py-2.5 text-left font-semibold">Account</th>
            <th className="px-4 py-2.5 text-left font-semibold">Type</th>
            <th className="px-4 py-2.5 text-right font-semibold">Debit</th>
            <th className="px-4 py-2.5 text-right font-semibold">Credit</th>
          </tr>
        </thead>
        <tbody>
          {tb.rows.map((r) => (
            <tr key={r.accountId} className="border-b last:border-0 hover:bg-accent/40">
              <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.code}</td>
              <td className="px-4 py-2 font-medium">{r.name}</td>
              <td className="px-4 py-2 text-xs capitalize text-muted-foreground">{r.type}</td>
              <td className="px-4 py-2 text-right">
                {r.debit > 0 ? <Money value={r.debit} /> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-4 py-2 text-right">
                {r.credit > 0 ? <Money value={r.credit} /> : <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 bg-muted/40 font-semibold">
            <td className="px-4 py-3" colSpan={3}>Total</td>
            <td className="px-4 py-3 text-right"><Money value={tb.totalDebit} /></td>
            <td className="px-4 py-3 text-right"><Money value={tb.totalCredit} /></td>
          </tr>
        </tbody>
      </ReportTable>
    </ReportShell>
  );
}
