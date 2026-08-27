'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EInvoiceMark, EWayMark } from '@/components/shared/einvoice-mark';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { contactName, effectiveInvoiceStatus, invoiceBalance } from '@/lib/selectors';
import { formatINRCompact } from '@/lib/money';
import type { Invoice } from '@/lib/types';

const FILTERS = ['all', 'draft', 'sent', 'partially_paid', 'overdue', 'paid', 'void'] as const;

export default function InvoicesPage() {
  const router = useRouter();
  const s = useAppStore();
  const canCreate = usePermission('sales', 'create');
  const [filter, setFilter] = useState<string>('all');

  const rows = useMemo(() => {
    const list = [...s.invoices].sort((a, b) => b.date.localeCompare(a.date));
    if (filter === 'all') return list;
    return list.filter((i) => effectiveInvoiceStatus(i) === filter);
  }, [s.invoices, filter]);

  const summary = useMemo(() => {
    const live = s.invoices.filter((i) => i.status !== 'void');
    return {
      count: live.length,
      total: live.reduce((t, i) => t + i.totalPaise, 0),
      due: live.reduce((t, i) => t + invoiceBalance(i), 0),
      awaitingIrn: live.filter(
        (i) => i.einvoice.status === 'pending' || i.einvoice.status === 'failed',
      ).length,
    };
  }, [s.invoices]);

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
          toolbar={
            <Combobox
              options={FILTERS.map((f) => ({
                value: f,
                label: f === 'all' ? 'All statuses' : f.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase()),
              }))}
              value={filter}
              onChange={setFilter}
              showAvatar={false}
              searchPlaceholder="Filter status"
              className="w-44"
            />
          }
        />
      )}
    </>
  );
}
