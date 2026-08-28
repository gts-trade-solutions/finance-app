'use client';

// Common chrome for every report: date range, export, print, and the
// "this is derived from N journal entries" provenance line.

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useAppStore } from '@/lib/store';
import { today } from '@/lib/selectors';
import { DateRangePicker } from '@/components/shared/date-range-picker';
import { describeRangeLong, fromPreset, type RangeValue } from '@/lib/date-range';

export type { DateRange } from '@/lib/date-range';

/**
 * Reports open on the current financial year, because that is the period a
 * report is almost always wanted for and it matches the figures the org's
 * returns are filed against.
 */
export function useReportRange(): [RangeValue, (r: RangeValue) => void] {
  const [range, setRange] = useState<RangeValue>(() => fromPreset('this_fy', today()));
  return [range, setRange];
}

/** Download any table as CSV — used by every report's Export button. */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportShell({
  title,
  description,
  range,
  onRangeChange,
  showRange = true,
  asOfOnly = false,
  onExport,
  children,
  extraActions,
  dataDates,
}: {
  title: string;
  description: string;
  range?: RangeValue;
  onRangeChange?: (r: RangeValue) => void;
  showRange?: boolean;
  asOfOnly?: boolean;
  onExport?: () => void;
  children: ReactNode;
  extraActions?: ReactNode;
  /** Transaction dates, so the picker only offers financial years with data. */
  dataDates?: string[];
}) {
  const s = useAppStore();

  return (
    <>
      <div className="no-print space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 gap-1.5">
          <Link href="/reports"><ArrowLeft className="size-3.5" /> All reports</Link>
        </Button>

        <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {showRange && range && onRangeChange && (
              asOfOnly ? (
                // A balance sheet is a snapshot, not a period — offering a
                // range here would invite a question the report cannot answer.
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">As at</label>
                  <Input
                    type="date"
                    value={range.to}
                    onChange={(e) => onRangeChange({ ...range, to: e.target.value, mode: 'day' })}
                    className="h-9 w-40"
                  />
                </div>
              ) : (
                <DateRangePicker
                  value={range}
                  onChange={onRangeChange}
                  dataDates={dataDates}
                  label="Period"
                />
              )
            )}
            {extraActions}
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5">
                <Download className="size-3.5" /> Export
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
              <Printer className="size-3.5" /> Print
            </Button>
          </div>
        </div>
      </div>

      {/* Print header */}
      <div className="print-only mb-4 border-b pb-3">
        <p className="text-lg font-bold">{s.org?.name}</p>
        <p className="text-sm font-semibold">{title}</p>
        {range && (
          <p className="text-xs text-neutral-600">
            {asOfOnly
              ? `As at ${new Date(range.to).toLocaleDateString('en-IN')}`
              : describeRangeLong(range)}
          </p>
        )}
      </div>

      {children}

      <p className="no-print text-xs text-muted-foreground">
        Derived live from {s.entries.length} journal entries. Nothing on this page is stored — change a document and
        this report changes with it.
      </p>
    </>
  );
}

/** Standard report table wrapper. */
export function ReportTable({ children }: { children: ReactNode }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-sm">{children}</table>
      </div>
    </Card>
  );
}
