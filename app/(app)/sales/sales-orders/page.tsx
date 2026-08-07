'use client';

import { ArrowRight, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { contactName, today } from '@/lib/selectors';
import { convertSOToInvoice } from '@/lib/services/sales';
import type { SalesOrder } from '@/lib/types';

export default function SalesOrdersPage() {
  const s = useAppStore();
  const router = useRouter();
  const canCreate = usePermission('sales', 'create');

  const columns: Column<SalesOrder>[] = [
    { key: 'number', header: 'Order #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customer', header: 'Customer', sortValue: (r) => contactName(s, r.customerId), cell: (r) => contactName(s, r.customerId) },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'invoiced', header: 'Invoiced', align: 'right', sortValue: (r) => r.invoicedPaise, cell: (r) => <Money value={r.invoicedPaise} showZero={false} /> },
    { key: 'total', header: 'Total', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        r.status === 'invoiced' ? (
          <span className="text-xs text-muted-foreground">Invoiced</span>
        ) : canCreate ? (
          <Button
            size="xs"
            className="gap-1"
            onClick={() => {
              const due = new Date(today());
              due.setDate(due.getDate() + 30);
              const inv = convertSOToInvoice(r.id, due.toISOString().slice(0, 10));
              toast.success(`Invoice ${inv.number} created`, { description: 'Posted to the ledger.' });
              router.push(`/sales/invoices/${inv.id}`);
            }}
          >
            Convert to invoice <ArrowRight className="size-3" />
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Sales orders"
        description="Confirmed orders awaiting fulfilment. Convert to an invoice when the goods ship."
      />
      {s.salesOrders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No sales orders"
          description="Accept an estimate and convert it to an order to see it here."
        />
      ) : (
        <DataTable rows={s.salesOrders} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} />
      )}
    </>
  );
}
