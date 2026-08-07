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

export interface DateRange {
  from: string;
  to: string;
}

export function useReportRange(): [DateRange, (r: DateRange) => void] {
  const org = useAppStore((s) => s.org);
  const [range, setRange] = useState<DateRange>({
    from: org?.fiscalYearStart ?? '2026-04-01',
    to: today(),
  });
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
}: {
  title: string;
  description: string;
  range?: DateRange;
  onRangeChange?: (r: DateRange) => void;
  showRange?: boolean;
  asOfOnly?: boolean;
  onExport?: () => void;
  children: ReactNode;
  extraActions?: ReactNode;
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
              <>
                {!asOfOnly && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">From</label>
                    <Input
                      type="date"
                      value={range.from}
                      onChange={(e) => onRangeChange({ ...range, from: e.target.value })}
                      className="h-8 w-36"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {asOfOnly ? 'As at' : 'To'}
                  </label>
                  <Input
                    type="date"
                    value={range.to}
                    onChange={(e) => onRangeChange({ ...range, to: e.target.value })}
                    className="h-8 w-36"
                  />
                </div>
              </>
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
              : `${new Date(range.from).toLocaleDateString('en-IN')} to ${new Date(range.to).toLocaleDateString('en-IN')}`}
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
