'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Mail, Phone, Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { StatTile } from '@/components/shared/stat-tile';
import { useAppStore } from '@/lib/store';
import { effectiveInvoiceStatus, invoiceBalance } from '@/lib/selectors';
import { formatINRCompact } from '@/lib/money';
import { stateName } from '@/lib/tax/gst';
import type { Invoice, Payment } from '@/lib/types';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const s = useAppStore();
  const c = s.contacts.find((x) => x.id === id);

  if (!c) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">Customer not found.</Card>;
  }

  const invoices = s.invoices.filter((i) => i.customerId === c.id);
  const payments = s.payments.filter((p) => p.kind === 'received' && p.contactId === c.id);
  const outstanding = invoices
    .filter((i) => i.status !== 'void' && i.status !== 'draft')
    .reduce((t, i) => t + invoiceBalance(i), 0);
  const invoiced = invoices.filter((i) => i.status !== 'void').reduce((t, i) => t + i.totalPaise, 0);
  const received = payments.reduce((t, p) => t + p.amountPaise + p.tdsPaise, 0);

  const invCols: Column<Invoice>[] = [
    { key: 'number', header: 'Invoice #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    { key: 'due', header: 'Due', sortValue: (r) => r.dueDate, cell: (r) => new Date(r.dueDate).toLocaleDateString('en-IN') },
    { key: 'status', header: 'Status', sortValue: (r) => effectiveInvoiceStatus(r), cell: (r) => <StatusBadge status={effectiveInvoiceStatus(r)} /> },
    { key: 'total', header: 'Total', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} /> },
    { key: 'balance', header: 'Balance', align: 'right', sortValue: (r) => invoiceBalance(r), cell: (r) => <Money value={invoiceBalance(r)} /> },
  ];

  const payCols: Column<Payment>[] = [
    { key: 'number', header: 'Payment #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    { key: 'mode', header: 'Mode', sortValue: (r) => r.mode, cell: (r) => <span className="text-xs uppercase">{r.mode}</span> },
    { key: 'tds', header: 'TDS withheld', align: 'right', sortValue: (r) => r.tdsPaise, cell: (r) => <Money value={r.tdsPaise} showZero={false} /> },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => r.amountPaise, cell: (r) => <Money value={r.amountPaise} /> },
  ];

  return (
    <>
      <PageHeader
        title={c.displayName}
        description={`${c.gstin ? `GSTIN ${c.gstin}` : c.gstTreatment.replace('_', ' ')} · ${stateName(c.stateCode)}`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/sales/payments/new?customer=${c.id}`}>Record payment</Link>
            </Button>
            <Button size="sm" asChild className="gap-1.5">
              <Link href="/sales/invoices/new"><Plus className="size-4" /> New invoice</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Outstanding" value={formatINRCompact(outstanding)} tone={outstanding > 0 ? 'warning' : 'positive'} />
        <StatTile label="Total invoiced" value={formatINRCompact(invoiced)} />
        <StatTile label="Total received" value={formatINRCompact(received)} tone="positive" />
        <StatTile
          label="Credit limit"
          value={c.creditLimit ? formatINRCompact(c.creditLimit) : 'None'}
          sub={c.creditLimit && outstanding > c.creditLimit ? 'Exceeded' : undefined}
          tone={c.creditLimit && outstanding > c.creditLimit ? 'danger' : 'default'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold">Contact</h3>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 text-muted-foreground">
              <Mail className="size-3.5" /> {c.email}
            </p>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Phone className="size-3.5" /> {c.phone}
            </p>
          </div>
          <div className="border-t pt-3 text-sm">
            <p className="text-xs text-muted-foreground">Billing address</p>
            <p className="mt-0.5">
              {c.billingAddress.line1}, {c.billingAddress.city} {c.billingAddress.pincode}
            </p>
          </div>
          <div className="border-t pt-3 text-sm">
            <p className="text-xs text-muted-foreground">Payment terms</p>
            <p className="mt-0.5">{c.paymentTermsDays === 0 ? 'Due on receipt' : `Net ${c.paymentTermsDays} days`}</p>
          </div>
          {c.customerDeductsTds && (
            <Badge variant="secondary" className="w-full justify-center text-[11px]">
              Deducts TDS on our invoices
            </Badge>
          )}
          {c.portalEnabled && (
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href="/portal">View client portal</Link>
            </Button>
          )}
        </Card>

        <div className="lg:col-span-3">
          <Tabs defaultValue="invoices">
            <TabsList>
              <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
              <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="invoices" className="mt-4">
              <DataTable
                rows={invoices}
                columns={invCols}
                getRowId={(r) => r.id}
                onRowClick={(r) => router.push(`/sales/invoices/${r.id}`)}
                searchable={false}
                emptyMessage="No invoices for this customer yet."
              />
            </TabsContent>
            <TabsContent value="payments" className="mt-4">
              <DataTable
                rows={payments}
                columns={payCols}
                getRowId={(r) => r.id}
                searchable={false}
                emptyMessage="No payments recorded yet."
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
