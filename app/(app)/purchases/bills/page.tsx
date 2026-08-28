'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { billBalance, contactName, today } from '@/lib/selectors';
import { formatINRCompact } from '@/lib/money';
import type { Bill } from '@/lib/types';

export default function BillsPage() {
  const router = useRouter();
  const s = useAppStore();
  const canCreate = usePermission('purchases', 'create');

  const live = s.bills.filter((b) => b.status !== 'void');
  const summary = {
    total: live.reduce((t, b) => t + b.totalPaise, 0),
    due: live.reduce((t, b) => t + billBalance(b), 0),
    overdue: live.filter((b) => billBalance(b) > 0 && b.dueDate < today()).reduce((t, b) => t + billBalance(b), 0),
    tds: live.reduce((t, b) => t + b.tdsPaise, 0),
  };

  const columns: Column<Bill>[] = [
    {
      key: 'internalNo',
      header: 'Bill #',
      sortValue: (r) => r.internalNo,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.internalNo}</p>
          <p className="text-xs text-muted-foreground">{r.number}</p>
        </div>
      ),
    },
    { key: 'vendor', header: 'Vendor', sortValue: (r) => contactName(s, r.vendorId), cell: (r) => contactName(s, r.vendorId) },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) },
    {
      key: 'due',
      header: 'Due',
      sortValue: (r) => r.dueDate,
      cell: (r) => {
        const overdue = billBalance(r) > 0 && r.dueDate < today();
        return (
          <span className={overdue ? 'text-destructive' : undefined}>
            {new Date(r.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
          </span>
        );
      },
    },
    {
      key: 'flags',
      header: 'Flags',
      sortValue: (r) => `${r.isRcm}${r.tdsSection ?? ''}`,
      cell: (r) => (
        <div className="flex gap-1">
          {r.isRcm && <Badge variant="outline" className="border-blue-500/40 text-[10px]">RCM</Badge>}
          {r.tdsSection && <Badge variant="outline" className="border-amber-500/40 text-[10px]">{r.tdsSection}</Badge>}
          {!r.isRcm && !r.tdsSection && <span className="text-xs text-muted-foreground">—</span>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'tds', header: 'TDS', align: 'right', sortValue: (r) => r.tdsPaise, cell: (r) => <Money value={r.tdsPaise} showZero={false} className="text-muted-foreground" /> },
    { key: 'total', header: 'Payable', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} /> },
    { key: 'balance', header: 'Balance', align: 'right', sortValue: (r) => billBalance(r), cell: (r) => <Money value={billBalance(r)} className={billBalance(r) > 0 ? 'font-medium' : 'text-muted-foreground'} /> },
  ];

  return (
    <>
      <PageHeader
        title="Bills"
        description="Supplier invoices. Input credit is separated from cost, and TDS is withheld automatically at threshold."
        actions={
          canCreate && (
            <Button size="sm" asChild className="gap-1.5">
              <Link href="/purchases/bills/new"><Plus className="size-4" /> New bill</Link>
            </Button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-3.5"><p className="text-xs text-muted-foreground">Total billed</p><p className="mt-1 text-xl font-semibold tabular">{formatINRCompact(summary.total)}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-muted-foreground">Outstanding</p><p className="mt-1 text-xl font-semibold tabular">{formatINRCompact(summary.due)}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-muted-foreground">Overdue</p><p className="mt-1 text-xl font-semibold tabular text-destructive">{formatINRCompact(summary.overdue)}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-muted-foreground">TDS withheld</p><p className="mt-1 text-xl font-semibold tabular">{formatINRCompact(summary.tds)}</p></Card>
      </div>

      {s.bills.length === 0 ? (
        <EmptyState icon={FileText} title="No bills yet" description="Record your first supplier invoice." />
      ) : (
        <DataTable
          dateFilter={{ getDate: (r) => r.date }}
          rows={s.bills}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/purchases/bills/${r.id}`)}
          initialSort={{ key: 'date', dir: 'desc' }}
          searchPlaceholder="Search bill no. or vendor…"
        />
      )}
    </>
  );
}
