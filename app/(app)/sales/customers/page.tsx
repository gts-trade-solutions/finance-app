'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { customers, invoiceBalance } from '@/lib/selectors';
import { stateName } from '@/lib/tax/gst';
import type { Contact } from '@/lib/types';

export default function CustomersPage() {
  const router = useRouter();
  const s = useAppStore();
  const canCreate = usePermission('sales', 'create');
  const list = customers(s);

  const outstanding = (c: Contact) =>
    s.invoices
      .filter((i) => i.customerId === c.id && i.status !== 'void' && i.status !== 'draft')
      .reduce((t, i) => t + invoiceBalance(i), 0);

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: 'Customer',
      sortValue: (r) => r.displayName,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.displayName}</p>
          <p className="text-xs text-muted-foreground">{r.email}</p>
        </div>
      ),
    },
    {
      key: 'gstin',
      header: 'GSTIN / Treatment',
      sortValue: (r) => r.gstin ?? r.gstTreatment,
      cell: (r) =>
        r.gstin ? (
          <span className="font-mono text-xs">{r.gstin}</span>
        ) : (
          <Badge variant="secondary" className="text-[10px] capitalize">
            {r.gstTreatment.replace('_', ' ')}
          </Badge>
        ),
    },
    {
      key: 'state',
      header: 'State',
      sortValue: (r) => stateName(r.stateCode),
      cell: (r) => (
        <span className="text-sm">
          {stateName(r.stateCode)}
          <span className="ml-1 text-xs text-muted-foreground">({r.stateCode})</span>
        </span>
      ),
    },
    {
      key: 'terms',
      header: 'Terms',
      sortValue: (r) => r.paymentTermsDays,
      cell: (r) => <span className="text-sm">{r.paymentTermsDays === 0 ? 'Due on receipt' : `Net ${r.paymentTermsDays}`}</span>,
    },
    {
      key: 'limit',
      header: 'Credit limit',
      align: 'right',
      sortValue: (r) => r.creditLimit ?? 0,
      cell: (r) => (r.creditLimit ? <Money value={r.creditLimit} whole /> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      align: 'right',
      sortValue: (r) => outstanding(r),
      cell: (r) => {
        const bal = outstanding(r);
        const over = r.creditLimit != null && bal > r.creditLimit;
        return (
          <div className="flex items-center justify-end gap-1.5">
            {over && <Badge variant="outline" className="border-red-500/40 text-[10px] text-red-600 dark:text-red-400">Over limit</Badge>}
            <Money value={bal} className={bal > 0 ? 'font-medium' : 'text-muted-foreground'} />
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description="A customer's state decides whether their invoices carry CGST+SGST or IGST."
        actions={
          canCreate && (
            <Button size="sm" asChild className="gap-1.5">
              <Link href="/sales/customers/new">
                <Plus className="size-4" /> New customer
              </Link>
            </Button>
          )
        }
      />
      {list.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" description="Add your first customer to start invoicing." />
      ) : (
        <DataTable
          rows={list}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/sales/customers/${r.id}`)}
          searchPlaceholder="Search name, GSTIN or state…"
        />
      )}
    </>
  );
}
