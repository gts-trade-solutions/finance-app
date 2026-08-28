'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Download, FileCheck2, Plus, Receipt, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EInvoiceMark, EWayMark } from '@/components/shared/einvoice-mark';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { ALL_TIME, withinRange, type RangeValue } from '@/lib/date-range';
import { usePermission } from '@/lib/store/hooks';
import { contactName, effectiveInvoiceStatus, invoiceBalance } from '@/lib/selectors';
import { formatINRCompact, toRupees } from '@/lib/money';
import { downloadCsv } from '@/components/shared/report-shell';
import { markInvoiceSent } from '@/lib/services/sales';
import { submitToIrp } from '@/lib/mock/simulators';
import type { Invoice } from '@/lib/types';

const FILTERS = ['all', 'draft', 'sent', 'partially_paid', 'overdue', 'paid', 'void'] as const;

const TAB_LABEL: Record<(typeof FILTERS)[number], string> = {
  all: 'All',
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially Paid',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
};

export default function InvoicesPage() {
  const router = useRouter();
  const s = useAppStore();
  const canCreate = usePermission('sales', 'create');
  const canEdit = usePermission('sales', 'edit');
  const [filter, setFilter] = useState<string>('all');
  // The range is held here rather than inside the table, so the status tabs and
  // the summary tiles describe the same period the table is showing. A tab
  // reading "Paid 44" above five visible rows is worse than no count at all.
  const [range, setRange] = useState<RangeValue>(() => ({ ...ALL_TIME, mode: 'all' }));

  const inPeriod = useMemo(
    () => (range.mode === 'all' ? s.invoices : s.invoices.filter((i) => withinRange(i.date, range))),
    [s.invoices, range],
  );

  const rows = useMemo(() => {
    const list = [...inPeriod].sort((a, b) => b.date.localeCompare(a.date));
    if (filter === 'all') return list;
    return list.filter((i) => effectiveInvoiceStatus(i) === filter);
  }, [inPeriod, filter]);

  // Counts sit on the tabs, so the shape of the workload is visible without
  // clicking through each filter.
  const tabs = useMemo(
    () =>
      FILTERS.map((f) => ({
        value: f,
        label: TAB_LABEL[f],
        count:
          f === 'all'
            ? inPeriod.length
            : inPeriod.filter((i) => effectiveInvoiceStatus(i) === f).length,
      })).filter((t) => t.value === 'all' || t.count > 0),
    [inPeriod],
  );

  const summary = useMemo(() => {
    const live = inPeriod.filter((i) => i.status !== 'void');
    return {
      count: live.length,
      total: live.reduce((t, i) => t + i.totalPaise, 0),
      due: live.reduce((t, i) => t + invoiceBalance(i), 0),
      awaitingIrn: live.filter(
        (i) => i.einvoice.status === 'pending' || i.einvoice.status === 'failed',
      ).length,
    };
  }, [inPeriod]);

  const columns: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice #',
      sortValue: (r) => r.number,
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{r.number}</span>
          <EInvoiceMark einvoice={r.einvoice} />
          <EWayMark ewbNo={r.ewayBillNo} />
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (r) => contactName(s, r.customerId),
      cell: (r) => contactName(s, r.customerId),
    },
    {
      key: 'date',
      header: 'Date',
      sortValue: (r) => r.date,
      cell: (r) => new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }),
    },
    {
      key: 'due',
      header: 'Due',
      sortValue: (r) => r.dueDate,
      cell: (r) => new Date(r.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }),
    },
    {
      key: 'supply',
      header: 'Supply',
      sortValue: (r) => r.supplyType,
      cell: (r) => (
        <span className="text-xs uppercase text-muted-foreground">
          {r.supplyType === 'intra' ? 'CGST+SGST' : r.supplyType === 'inter' ? 'IGST' : r.supplyType.replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (r) => effectiveInvoiceStatus(r),
      cell: (r) => <StatusBadge status={effectiveInvoiceStatus(r)} />,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortValue: (r) => r.totalPaise,
      cell: (r) => <Money value={r.totalPaise} />,
    },
    {
      key: 'balance',
      header: 'Balance due',
      align: 'right',
      sortValue: (r) => invoiceBalance(r),
      cell: (r) => (
        <Money value={invoiceBalance(r)} className={invoiceBalance(r) > 0 ? 'font-medium' : 'text-muted-foreground'} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every approved invoice posts a balanced journal entry the moment it is created."
        actions={
          canCreate && (
            <Button size="sm" asChild className="gap-1.5">
              <Link href="/sales/invoices/new">
                <Plus className="size-4" /> New invoice
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-3.5">
          <p className="text-xs text-muted-foreground">Invoices</p>
          <p className="mt-1 text-xl font-semibold tabular">{summary.count}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs text-muted-foreground">Total invoiced</p>
          <p className="mt-1 text-xl font-semibold tabular">{formatINRCompact(summary.total)}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="mt-1 text-xl font-semibold tabular text-amber-600 dark:text-amber-400">
            {formatINRCompact(summary.due)}
          </p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs text-muted-foreground">Awaiting IRN</p>
          <p className="mt-1 text-xl font-semibold tabular">{summary.awaitingIrn}</p>
        </Card>
      </div>

      {s.invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices yet"
          description="Create your first invoice — GST is worked out automatically from the customer's state."
          action={
            <Button asChild>
              <Link href="/sales/invoices/new">New invoice</Link>
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/sales/invoices/${r.id}`)}
          searchPlaceholder="Search invoice no. or customer…"
          initialSort={{ key: 'date', dir: 'desc' }}
          tabs={tabs}
          activeTab={filter}
          onTabChange={setFilter}
          dateFilter={{ getDate: (r) => r.date, value: range, onChange: setRange }}
          selectable={canEdit}
          bulkActions={(selected, clear) => (
            <>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  const n = selected.filter((i) => i.status === 'approved').length;
                  selected.forEach((i) => markInvoiceSent(i.id));
                  toast.success(`${n || selected.length} invoice(s) emailed`);
                  clear();
                }}
                className="gap-1"
              >
                <Send className="size-3" /> Send
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  const pending = selected.filter(
                    (i) => i.einvoice.status === 'pending' || i.einvoice.status === 'failed',
                  );
                  if (pending.length === 0) {
                    toast.info('Nothing to report — all selected invoices already have an IRN.');
                    return;
                  }
                  toast.info(`Submitting ${pending.length} invoice(s) to the IRP…`);
                  let ok = 0;
                  for (const i of pending) if ((await submitToIrp(i.id)).ok) ok += 1;
                  toast.success(`${ok} of ${pending.length} registered`);
                  clear();
                }}
                className="gap-1"
              >
                <FileCheck2 className="size-3" /> Submit to IRP
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  downloadCsv('invoices.csv', [
                    ['Invoice', 'Customer', 'Date', 'Due', 'Status', 'Total', 'Balance'],
                    ...selected.map((i) => [
                      i.number, contactName(s, i.customerId), i.date, i.dueDate,
                      effectiveInvoiceStatus(i), toRupees(i.totalPaise), toRupees(invoiceBalance(i)),
                    ]),
                  ]);
                  toast.success(`${selected.length} invoice(s) exported`);
                }}
                className="gap-1"
              >
                <Download className="size-3" /> Export
              </Button>
            </>
          )}
        />
      )}
    </>
  );
}
