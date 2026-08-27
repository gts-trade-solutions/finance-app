'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Money } from '@/components/shared/money';
import {
  downloadCsv, ReportShell, ReportTable, useReportRange,
} from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { Combobox } from '@/components/ui/combobox';
import { accountOptions } from '@/lib/options';
import { generalLedger } from '@/lib/ledger/reports';
import { toRupees } from '@/lib/money';
import { ACC } from '@/lib/mock/seed/accounts';

/** Where a source document lives, so every ledger line can drill through. */
const SOURCE_ROUTE: Record<string, string> = {
  invoice: '/sales/invoices',
  bill: '/purchases/bills',
};

export default function GeneralLedgerPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();
  const [accountId, setAccountId] = useState<string>(ACC.AR);

  const rows = useMemo(
    () => generalLedger(s.entries, accountId, range),
    [s.entries, accountId, range],
  );
  const account = s.accounts.find((a) => a.id === accountId);
  const closing = rows.length ? rows[rows.length - 1].running : 0;

  return (
    <ReportShell
      title="General Ledger"
      description="Every movement through a single account, in order, with a running balance. This is the drill-down behind every other report."
      range={range}
      onRangeChange={setRange}
      extraActions={
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Account</label>
          <Combobox
            options={accountOptions(s)}
            value={accountId}
            onChange={setAccountId}
            placeholder="Select account"
            searchPlaceholder="Search accounts by name or code"
            showAvatar={false}
            className="w-64"
          />
        </div>
      }
      onExport={() =>
        downloadCsv(`general-ledger-${account?.code}.csv`, [
          ['Date', 'JE#', 'Source', 'Narration', 'Debit', 'Credit', 'Balance'],
          ...rows.map((r) => [
            r.date, r.entryNo, r.sourceType, r.memo,
            toRupees(r.debit), toRupees(r.credit), toRupees(r.running),
          ]),
        ])
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-4">
        <div>
          <p className="text-xs text-muted-foreground">Account</p>
          <p className="font-medium">
            <span className="font-mono text-sm text-muted-foreground">{account?.code}</span> {account?.name}
          </p>
          <p className="mt-0.5 text-xs capitalize text-muted-foreground">{account?.type}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Closing balance</p>
          <Money value={Math.abs(closing)} className="text-xl font-semibold" />
          <p className="text-xs text-muted-foreground">{closing >= 0 ? 'Debit' : 'Credit'}</p>
        </div>
      </div>

      <ReportTable>
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-semibold">Date</th>
            <th className="px-4 py-2.5 text-left font-semibold">JE #</th>
            <th className="px-4 py-2.5 text-left font-semibold">Narration</th>
            <th className="px-4 py-2.5 text-left font-semibold">Source</th>
            <th className="px-4 py-2.5 text-right font-semibold">Debit</th>
            <th className="px-4 py-2.5 text-right font-semibold">Credit</th>
            <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                No movement on this account in the selected period.
              </td>
            </tr>
          ) : (
            rows.map((r, idx) => (
              <tr key={`${r.entryId}-${idx}`} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-4 py-2 text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">#{r.entryNo}</td>
                <td className="px-4 py-2">{r.memo}</td>
                <td className="px-4 py-2">
                  {r.sourceId && SOURCE_ROUTE[r.sourceType] ? (
                    <Link
                      href={`${SOURCE_ROUTE[r.sourceType]}/${r.sourceId}`}
                      className="text-xs capitalize text-primary hover:underline"
                    >
                      {r.sourceType.replace('_', ' ')} ↗
                    </Link>
                  ) : (
                    <span className="text-xs capitalize text-muted-foreground">{r.sourceType.replace('_', ' ')}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.debit > 0 ? <Money value={r.debit} /> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.credit > 0 ? <Money value={r.credit} /> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-2 text-right font-medium"><Money value={r.running} /></td>
              </tr>
            ))
          )}
        </tbody>
      </ReportTable>
    </ReportShell>
  );
}
