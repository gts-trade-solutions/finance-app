'use client';

import Link from 'next/link';
import { Plus, Wallet } from 'lucide-react';
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

export default function PaymentsReceivedPage() {
  const s = useAppStore();
  const canCreate = usePermission('sales', 'create');
  const rows = s.payments.filter((p) => p.kind === 'received');

  const columns: Column<Payment>[] = [
    { key: 'number', header: 'Payment #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customer', header: 'Customer', sortValue: (r) => contactName(s, r.contactId), cell: (r) => contactName(s, r.contactId) },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) },
    { key: 'mode', header: 'Mode', sortValue: (r) => r.mode, cell: (r) => <Badge variant="secondary" className="uppercase text-[10px]">{r.mode}</Badge> },
    { key: 'ref', header: 'Reference', sortValue: (r) => r.reference, cell: (r) => <span className="text-xs text-muted-foreground">{r.reference || '—'}</span> },
    { key: 'applied', header: 'Applied to', sortValue: (r) => r.allocations.length, cell: (r) => <span className="text-xs">{r.allocations.length} invoice(s)</span> },
    { key: 'tds', header: 'TDS', align: 'right', sortValue: (r) => r.tdsPaise, cell: (r) => <Money value={r.tdsPaise} showZero={false} className="text-muted-foreground" /> },
    { key: 'unapplied', header: 'On account', align: 'right', sortValue: (r) => r.unappliedPaise, cell: (r) => <Money value={r.unappliedPaise} showZero={false} /> },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => r.amountPaise, cell: (r) => <Money value={r.amountPaise} className="font-medium" /> },
  ];

  return (
    <>
      <PageHeader
        title="Payments received"
        description="One receipt can settle many invoices. TDS the customer withheld is tracked as a recoverable asset."
        actions={
          canCreate && (
            <Button size="sm" asChild className="gap-1.5">
              <Link href="/sales/payments/new"><Plus className="size-4" /> Record payment</Link>
            </Button>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments yet" description="Record your first customer receipt." />
      ) : (
        <DataTable rows={rows} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} searchPlaceholder="Search payment or customer…" />
      )}
    </>
  );
}
