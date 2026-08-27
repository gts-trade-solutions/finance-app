'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, FileCheck2, Loader2, TriangleAlert, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatTile } from '@/components/shared/stat-tile';
import { StatusBadge } from '@/components/shared/status-badge';
import { EInvoiceMark } from '@/components/shared/einvoice-mark';
import { useAppStore } from '@/lib/store';
import { contactName, today } from '@/lib/selectors';
import { submitToIrp } from '@/lib/mock/simulators';
import { formatINRCompact } from '@/lib/money';
import type { Invoice } from '@/lib/types';

/** Days remaining in the 30-day IRP reporting window. */
function daysLeft(invoiceDate: string): number {
  const deadline = new Date(invoiceDate);
  deadline.setDate(deadline.getDate() + 30);
  return Math.ceil((deadline.getTime() - new Date(today()).getTime()) / 86_400_000);
}

export default function EInvoicesPage() {
  const s = useAppStore();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const applicable = useMemo(
    () => s.invoices.filter((i) => i.einvoice.status !== 'not_applicable' && i.status !== 'void'),
    [s.invoices],
  );
  const pending = applicable.filter((i) => i.einvoice.status === 'pending' || i.einvoice.status === 'failed');
  const registered = applicable.filter((i) => i.einvoice.status === 'submitted');
  const urgent = pending.filter((i) => daysLeft(i.date) <= 7);

  const submitOne = async (id: string) => {
    setBusy(id);
    const res = await submitToIrp(id);
    setBusy(null);
    if (res.ok) toast.success('IRN generated');
    else toast.error('IRP rejected the invoice', { description: res.error });
  };

  const submitAll = async () => {
    setBulkBusy(true);
    let ok = 0, failed = 0;
    for (const inv of pending) {
      const res = await submitToIrp(inv.id);
      if (res.ok) ok += 1; else failed += 1;
    }
    setBulkBusy(false);
    toast[failed ? 'warning' : 'success'](`${ok} registered, ${failed} failed`, {
      description: failed ? 'Open the failed ones to see the IRP error and retry.' : 'All pending invoices now carry an IRN.',
    });
  };

  const columns: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice #',
      sortValue: (r) => r.number,
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{r.number}</span>
          <EInvoiceMark einvoice={r.einvoice} />
        </div>
      ),
    },
    { key: 'customer', header: 'Customer', sortValue: (r) => contactName(s, r.customerId), cell: (r) => contactName(s, r.customerId) },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) },
    { key: 'total', header: 'Value', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} /> },
    { key: 'status', header: 'IRP status', sortValue: (r) => r.einvoice.status, cell: (r) => <StatusBadge status={r.einvoice.status} /> },
    {
      key: 'deadline',
      header: 'Reporting window',
      sortValue: (r) => daysLeft(r.date),
      cell: (r) => {
        if (r.einvoice.status === 'submitted') {
          return <span className="text-xs text-muted-foreground">Reported</span>;
        }
        const d = daysLeft(r.date);
        return (
          <Badge
            variant="outline"
            className={
              d <= 0 ? 'border-red-500/40 text-[10px] text-red-600 dark:text-red-400'
                : d <= 7 ? 'border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-300'
                  : 'text-[10px]'
            }
          >
            {d <= 0 ? 'Window closed' : `${d} day${d === 1 ? '' : 's'} left`}
          </Badge>
        );
      },
    },
    {
      key: 'irn',
      header: 'IRN',
      sortValue: (r) => r.einvoice.irn ?? '',
      cell: (r) =>
        r.einvoice.irn ? (
          <span className="font-mono text-[10px] text-muted-foreground">{r.einvoice.irn.slice(0, 20)}…</span>
        ) : r.einvoice.error ? (
          <span className="text-[11px] text-destructive">{r.einvoice.error.slice(0, 44)}…</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        r.einvoice.status === 'submitted' ? null : (
          <Button size="xs" disabled={busy === r.id} onClick={(e) => { e.stopPropagation(); submitOne(r.id); }} className="gap-1">
            {busy === r.id ? <Loader2 className="size-3 animate-spin" /> : <FileCheck2 className="size-3" />}
            {r.einvoice.status === 'failed' ? 'Retry' : 'Submit'}
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="E-invoices (IRP)"
        description="B2B invoices must be registered with the government portal before they are legally valid."
        actions={
          pending.length > 0 && (
            <Button size="sm" onClick={submitAll} disabled={bulkBusy} className="gap-1.5">
              {bulkBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
              Submit all {pending.length} pending
            </Button>
          )
        }
      />

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <FileCheck2 className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">How e-invoicing works</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Above a turnover threshold, a B2B invoice isn&apos;t just a document you print — it has to be sent to the
            government&apos;s Invoice Registration Portal first. The portal checks it, then returns an Invoice
            Reference Number and a digitally signed QR code, which must appear on the printed invoice. Without them
            the invoice is not valid, your customer can be denied their input credit, and there is a
            <span className="font-medium text-foreground"> 30-day window</span> after the invoice date to report it.
            Miss the window and it can never be reported at all.
          </p>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Registered" value={String(registered.length)} sub="IRN issued" icon={FileCheck2} tone="positive" />
        <StatTile label="Pending" value={String(pending.length)} sub="Not yet reported" icon={Clock} tone={pending.length ? 'warning' : 'default'} />
        <StatTile label="Closing in 7 days" value={String(urgent.length)} sub="Report these first" icon={TriangleAlert} tone={urgent.length ? 'danger' : 'default'} />
        <StatTile
          label="Value pending"
          value={formatINRCompact(pending.reduce((t, i) => t + i.totalPaise, 0))}
          sub="Invoices without an IRN"
        />
      </div>

      <DataTable
        rows={applicable}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => router.push(`/sales/invoices/${r.id}`)}
        initialSort={{ key: 'deadline', dir: 'asc' }}
        searchPlaceholder="Search invoice or customer…"
        emptyMessage="No invoices require e-invoicing."
      />
    </>
  );
}
