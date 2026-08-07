'use client';

import { HandCoins, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import type { RetainerInvoice } from '@/lib/types';

export default function RetainersPage() {
  const s = useAppStore();

  const columns: Column<RetainerInvoice>[] = [
    { key: 'number', header: 'Retainer #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customer', header: 'Customer', sortValue: (r) => contactName(s, r.customerId), cell: (r) => contactName(s, r.customerId) },
    { key: 'desc', header: 'Description', sortValue: (r) => r.description, cell: (r) => <span className="text-sm text-muted-foreground">{r.description}</span> },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'applied', header: 'Applied', align: 'right', sortValue: (r) => r.appliedPaise, cell: (r) => <Money value={r.appliedPaise} showZero={false} /> },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => r.amountPaise, cell: (r) => <Money value={r.amountPaise} className="font-medium" /> },
  ];

  return (
    <>
      <PageHeader
        title="Retainer invoices"
        description="Advances collected before work is done."
      />

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">Why advances are not income</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            When a customer pays up front you have their money but haven&apos;t earned it yet — you owe them the work.
            So the receipt increases your bank <em>and</em> a liability called <span className="font-medium text-foreground">Unearned Revenue</span>.
            Only when you deliver and raise the real invoice does it become income. Booking it as income immediately
            would overstate your profit and your GST.
          </p>
        </div>
      </Card>

      {s.retainers.length === 0 ? (
        <EmptyState icon={HandCoins} title="No retainers" description="Collect an advance and it will be held as a liability until you invoice against it." />
      ) : (
        <DataTable rows={s.retainers} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} />
      )}
    </>
  );
}
