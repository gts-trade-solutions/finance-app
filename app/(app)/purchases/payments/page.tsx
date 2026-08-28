'use client';

import Link from 'next/link';
import { Banknote, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { contactName } from '@/lib/selectors';
import type { Payment } from '@/lib/types';

export default function PaymentsMadePage() {
  const s = useAppStore();
  const canCreate = usePermission('purchases', 'create');
  const rows = s.payments.filter((p) => p.kind === 'made');

  const columns: Column<Payment>[] = [
    { key: 'number', header: 'Payment #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'vendor', header: 'Vendor', sortValue: (r) => contactName(s, r.contactId), cell: (r) => contactName(s, r.contactId) },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) },
    { key: 'mode', header: 'Mode', sortValue: (r) => r.mode, cell: (r) => <Badge variant="secondary" className="uppercase text-[10px]">{r.mode}</Badge> },
    { key: 'ref', header: 'Reference', sortValue: (r) => r.reference, cell: (r) => <span className="text-xs text-muted-foreground">{r.reference || '—'}</span> },
    { key: 'bills', header: 'Bills settled', sortValue: (r) => r.allocations.length, cell: (r) => <span className="text-xs">{r.allocations.length}</span> },
    {
      key: 'account',
      header: 'Paid from',
      sortValue: (r) => s.bankAccounts.find((b) => b.id === r.bankAccountId)?.name ?? '',
      cell: (r) => <span className="text-xs">{s.bankAccounts.find((b) => b.id === r.bankAccountId)?.name}</span>,
    },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => r.amountPaise, cell: (r) => <Money value={r.amountPaise} className="font-medium" /> },
  ];

  return (
    <>
      <PageHeader
        title="Payments made"
        description="Vendor payments, including batch payment runs."
        actions={
          canCreate && (
            <Button size="sm" asChild className="gap-1.5">
              <Link href="/purchases/payments/new"><Plus className="size-4" /> Pay vendor</Link>
            </Button>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={Banknote} title="No vendor payments" description="Settle outstanding bills to see them here." />
      ) : (
        <DataTable rows={rows} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} searchPlaceholder="Search payment or vendor…" dateFilter={{ getDate: (r) => r.date }} />
      )}
    </>
  );
}
