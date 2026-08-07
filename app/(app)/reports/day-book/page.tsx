'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/shared/money';
import {
  downloadCsv, ReportShell, ReportTable, useReportRange,
} from '@/components/shared/report-shell';
import { useAppStore } from '@/lib/store';
import { toRupees } from '@/lib/money';

export default function DayBookPage() {
  const s = useAppStore();
  const [range, setRange] = useReportRange();

  const grouped = useMemo(() => {
    const entries = s.entries
      .filter((e) => e.date >= range.from && e.date <= range.to)
      .sort((a, b) => b.date.localeCompare(a.date) || b.entryNo - a.entryNo);
    const map = new Map<string, typeof entries>();
    for (const e of entries) {
      map.set(e.date, [...(map.get(e.date) ?? []), e]);
    }
    return [...map.entries()];
  }, [s.entries, range]);

  return (
    <ReportShell
      title="Day Book"
      description="Everything that happened, day by day — the chronological diary of the business."
      range={range}
      onRangeChange={setRange}
      onExport={() =>
        downloadCsv('day-book.csv', [
          ['Date', 'JE#', 'Type', 'Narration', 'Amount'],
          ...grouped.flatMap(([date, entries]) =>
            entries.map((e) => [
              date, e.entryNo, e.sourceType, e.memo,
              toRupees(e.lines.reduce((t, l) => t + l.debit, 0)),
            ]),
          ),
        ])
      }
    >
      {grouped.length === 0 ? (
        <ReportTable>
          <tbody>
            <tr>
              <td className="px-4 py-10 text-center text-sm text-muted-foreground">
                No activity in this period.
              </td>
            </tr>
          </tbody>
        </ReportTable>
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, entries]) => {
            const dayTotal = entries.reduce((t, e) => t + e.lines.reduce((x, l) => x + l.debit, 0), 0);
            return (
              <div key={date}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    {new Date(date).toLocaleDateString('en-IN', {
                      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · <Money value={dayTotal} />
                  </span>
                </div>
                <ReportTable>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-accent/40">
                        <td className="w-16 px-4 py-2 font-mono text-xs text-muted-foreground">#{e.entryNo}</td>
                        <td className="w-40 px-4 py-2">
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
                        <td className="w-32 px-4 py-2 text-right font-medium">
                          <Money value={e.lines.reduce((t, l) => t + l.debit, 0)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </ReportTable>
              </div>
            );
          })}
        </div>
      )}
    </ReportShell>
  );
}
