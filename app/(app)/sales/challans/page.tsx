'use client';

import { Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import type { DeliveryChallan } from '@/lib/types';

const TYPE_LABEL: Record<string, string> = {
  job_work: 'Job work',
  supply_on_approval: 'Supply on approval',
  own_use: 'Own branch transfer',
};

export default function ChallansPage() {
  const s = useAppStore();

  const columns: Column<DeliveryChallan>[] = [
    { key: 'number', header: 'Challan #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customer', header: 'Consignee', sortValue: (r) => contactName(s, r.customerId), cell: (r) => contactName(s, r.customerId) },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    {
      key: 'type',
      header: 'Purpose',
      sortValue: (r) => r.challanType,
      cell: (r) => <Badge variant="secondary" className="text-[10px]">{TYPE_LABEL[r.challanType]}</Badge>,
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'value', header: 'Goods value', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} /> },
  ];

  return (
    <>
      <PageHeader
        title="Delivery challans"
        description="Goods moving without a sale — job work, approval-basis supply, or branch transfers. No GST is charged and nothing posts to the ledger."
      />
      {s.challans.length === 0 ? (
        <EmptyState icon={Truck} title="No delivery challans" description="Used when goods leave your premises but no sale has happened yet." />
      ) : (
        <DataTable rows={s.challans} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} dateFilter={{ getDate: (r) => r.date }} />
      )}
    </>
  );
}
