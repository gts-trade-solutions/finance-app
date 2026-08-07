'use client';

import { Truck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { contactName, today } from '@/lib/selectors';
import type { EwayBill } from '@/lib/types';

export default function EwayBillsPage() {
  const s = useAppStore();

  const columns: Column<EwayBill>[] = [
    { key: 'ewb', header: 'E-way bill no.', sortValue: (r) => r.ewbNo, cell: (r) => <span className="font-mono font-medium">{r.ewbNo}</span> },
    {
      key: 'invoice',
      header: 'Invoice',
      sortValue: (r) => s.invoices.find((i) => i.id === r.invoiceId)?.number ?? '',
      cell: (r) => {
        const inv = s.invoices.find((i) => i.id === r.invoiceId);
        return (
          <div>
            <p className="font-medium">{inv?.number}</p>
            <p className="text-xs text-muted-foreground">{inv ? contactName(s, inv.customerId) : '—'}</p>
          </div>
        );
      },
    },
    { key: 'vehicle', header: 'Vehicle', sortValue: (r) => r.vehicleNo, cell: (r) => <span className="font-mono text-xs">{r.vehicleNo}</span> },
    { key: 'distance', header: 'Distance', align: 'right', sortValue: (r) => r.distanceKm, cell: (r) => <span className="tabular">{r.distanceKm} km</span> },
    {
      key: 'valid',
      header: 'Valid until',
      sortValue: (r) => r.validUntil,
      cell: (r) => {
        const expired = r.validUntil < today();
        return (
          <div className="flex items-center gap-2">
            <span className={expired ? 'text-destructive' : undefined}>
              {new Date(r.validUntil).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            </span>
            {expired && <Badge variant="outline" className="border-red-500/40 text-[9px]">Expired</Badge>}
          </div>
        );
      },
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'value',
      header: 'Consignment value',
      align: 'right',
      sortValue: (r) => s.invoices.find((i) => i.id === r.invoiceId)?.totalPaise ?? 0,
      cell: (r) => <Money value={s.invoices.find((i) => i.id === r.invoiceId)?.totalPaise ?? 0} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="E-way bills"
        description="The transport permit that must travel with the goods."
      />

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <Truck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">When you need one</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Moving goods worth more than ₹50,000 requires an electronic permit generated before the vehicle leaves.
            It carries the invoice details, the vehicle number and a validity period — roughly one day per 200 km.
            If the goods are stopped in transit without a valid e-way bill, they can be detained and penalised.
            Generate one from any invoice that already has an IRN.
          </p>
        </div>
      </Card>

      {s.ewayBills.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No e-way bills generated"
          description="Open a registered invoice and use “Generate e-way bill” to create one."
        />
      ) : (
        <DataTable rows={s.ewayBills} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'valid', dir: 'asc' }} />
      )}
    </>
  );
}
