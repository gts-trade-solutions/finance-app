'use client';

import { ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import type { PurchaseOrder } from '@/lib/types';

export default function PurchaseOrdersPage() {
  const s = useAppStore();

  const columns: Column<PurchaseOrder>[] = [
    { key: 'number', header: 'PO #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'vendor', header: 'Vendor', sortValue: (r) => contactName(s, r.vendorId), cell: (r) => contactName(s, r.vendorId) },
    { key: 'date', header: 'Issued', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    {
      key: 'expected',
      header: 'Expected',
      sortValue: (r) => r.expectedDate ?? '',
      cell: (r) => (r.expectedDate ? new Date(r.expectedDate).toLocaleDateString('en-IN') : '—'),
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'billed', header: 'Billed', align: 'right', sortValue: (r) => r.billedPaise, cell: (r) => <Money value={r.billedPaise} showZero={false} /> },
    { key: 'total', header: 'Order value', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} className="font-medium" /> },
  ];

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Commitments to buy. Nothing hits the ledger until the goods arrive and the bill is recorded."
      />
      {s.purchaseOrders.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No purchase orders" description="Raise a PO to formalise what you've ordered." />
      ) : (
        <DataTable rows={s.purchaseOrders} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} dateFilter={{ getDate: (r) => r.date }} />
      )}
    </>
  );
}
