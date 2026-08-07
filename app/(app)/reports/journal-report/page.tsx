'use client';

import { Fragment, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/shared/money';
import {
  downloadCsv, ReportShell, ReportTable, useReportRange,
} from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { toRupees } from '@/lib/money';

export default function JournalReportPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const entries = useMemo(
    () =>
      s.entries
        .filter((e) => e.date >= range.from && e.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date) || b.entryNo - a.entryNo),
    [s.entries, range],
  );

  const toggle = (id: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ReportShell
      title="Journal Report"
      description="Every journal entry with its full double-entry detail. Click a row to expand it. This is the complete, unfiltered record of the books."
      range={range}
      onRangeChange={setRange}
      onExport={() =>
        downloadCsv('journal-report.csv', [
          ['Date', 'JE#', 'Source', 'Narration', 'Account', 'Debit', 'Credit'],
          ...entries.flatMap((e) =>
            e.lines.map((l) => [
              e.date, e.entryNo, e.sourceType, e.memo,
              s.accounts.find((a) => a.id === l.accountId)?.name ?? '',
              toRupees(l.debit), toRupees(l.credit),
            ]),
          ),
        ])
      }
    >
      <ReportTable>
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-semibold">Date</th>
            <th className="px-4 py-2.5 text-left font-semibold">JE #</th>
            <th className="px-4 py-2.5 text-left font-semibold">Source</th>
            <th className="px-4 py-2.5 text-left font-semibold">Narration</th>
            <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                No journal entries in this period.
              </td>
            </tr>
          ) : (
            entries.map((e) => {
              const total = e.lines.reduce((t, l) => t + l.debit, 0);
              const isOpen = expanded.has(e.id);
              return (
                <Fragment key={e.id}>
                  <tr
                    onClick={() => toggle(e.id)}
                    className="cursor-pointer border-b hover:bg-accent/40"
                  >
                    <td className="px-4 py-2 text-xs">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">#{e.entryNo}</td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary" className="text-[10px] capitalize">
                        {e.sourceType.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {e.memo}
                      {e.isReversalOf && (
                        <Badge variant="outline" className="ml-2 border-destructive/40 text-[9px]">Reversal</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-medium"><Money value={total} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={5} className="px-4 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              <th className="pb-1.5 text-left font-semibold">Account</th>
                              <th className="pb-1.5 text-left font-semibold">Narration</th>
                              <th className="pb-1.5 text-right font-semibold">Debit</th>
                              <th className="pb-1.5 text-right font-semibold">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.lines.map((l, i) => {
                              const acc = s.accounts.find((a) => a.id === l.accountId);
                              return (
                                <tr key={i}>
                                  <td className="py-1">
                                    <span className="font-mono text-muted-foreground">{acc?.code}</span> {acc?.name}
                                  </td>
                                  <td className="py-1 text-muted-foreground">{l.description ?? '—'}</td>
                                  <td className="py-1 text-right">
                                    {l.debit > 0 ? <Money value={l.debit} /> : '—'}
                                  </td>
                                  <td className="py-1 text-right">
                                    {l.credit > 0 ? <Money value={l.credit} /> : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </ReportTable>
    </ReportShell>
  );
}
