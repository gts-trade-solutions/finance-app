'use client';

// E-way bills.
//
// Goods worth more than ₹50,000 cannot legally move without one. Services do
// not move, so they never need one — which is why this list is filtered to
// goods consignments above the threshold rather than to every invoice.
//
// Validity is one day per 200 km, minimum one day, counted from generation.
// An expired bill on a lorry that is still in transit is a detention risk, so
// the expiry is shown rather than buried.

import { useState } from 'react';
import { Loader2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { StatTile } from '@/components/shared/stat-tile';
import { AsyncPage } from '@/components/shared/async-state';
import { Field } from '@/components/shared/form-bits';
import { gst, type EwayBillRow } from '@/lib/api/client';
import { useApi, useApiAction } from '@/lib/api/use-api';
import { usePermission } from '@/lib/store/hooks';
import { formatINRCompact } from '@/lib/money';

const today = () => new Date().toISOString().slice(0, 10);

export default function EwayBillsPage() {
  const canGenerate = usePermission('gst', 'approve');
  const state = useApi<{ ewayBills: EwayBillRow[] }>(() => gst.ewayBills(), []);

  const [target, setTarget] = useState<EwayBillRow | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [transporter, setTransporter] = useState('');
  const [distance, setDistance] = useState(100);

  const generate = useApiAction(gst.generateEwayBill);

  const rows = state.data?.ewayBills ?? [];
  const generated = rows.filter((r) => r.status === 'generated');
  const needed = rows.filter((r) => r.status === 'not_generated');
  const expired = generated.filter((r) => r.validUntil && r.validUntil < today());

  const submit = async () => {
    if (!target) return;
    const done = await generate.run({
      invoiceId: target.invoiceId,
      vehicleNo: vehicleNo || null,
      transporterName: transporter || null,
      distanceKm: distance,
    });
    if (!done) {
      toast.error(generate.error ?? 'The e-way bill was not generated');
      return;
    }
    toast.success(`E-way bill ${done.ewayBillNo} generated`, {
      description: `Valid ${done.validDays} day(s) — one per 200 km.`,
    });
    setTarget(null);
    setVehicleNo('');
    setTransporter('');
    state.refetch();
  };

  const columns: Column<EwayBillRow>[] = [
    {
      key: 'ewb', header: 'E-way bill no.', sortValue: (r) => r.ewayBillNo ?? '',
      cell: (r) =>
        r.ewayBillNo ? (
          <span className="font-mono font-medium">{r.ewayBillNo}</span>
        ) : (
          <Badge variant="outline" className="border-amber-500/40 text-[10px]">Needed</Badge>
        ),
    },
    {
      key: 'invoice', header: 'Invoice', sortValue: (r) => r.number,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.number}</p>
          <p className="text-xs text-muted-foreground">{r.customerName}</p>
        </div>
      ),
    },
    {
      key: 'date', header: 'Date', sortValue: (r) => r.date,
      cell: (r) => <span className="tabular text-xs">{new Date(r.date).toLocaleDateString('en-IN')}</span>,
    },
    {
      key: 'vehicle', header: 'Vehicle', sortValue: (r) => r.vehicleNo ?? '',
      cell: (r) => <span className="font-mono text-xs">{r.vehicleNo ?? '—'}</span>,
    },
    {
      key: 'distance', header: 'Distance', align: 'right', sortValue: (r) => r.distanceKm ?? 0,
      cell: (r) => <span className="tabular">{r.distanceKm ? `${r.distanceKm} km` : '—'}</span>,
    },
    {
      key: 'valid', header: 'Valid until', sortValue: (r) => r.validUntil ?? '',
      cell: (r) => {
        if (!r.validUntil) return <span className="text-xs text-muted-foreground">—</span>;
        const isExpired = r.validUntil < today();
        return (
          <div className="flex items-center gap-2">
            <span className={isExpired ? 'text-destructive' : undefined}>
              {new Date(r.validUntil).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            </span>
            {isExpired && <Badge variant="outline" className="border-red-500/40 text-[9px]">Expired</Badge>}
          </div>
        );
      },
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'value', header: 'Consignment', align: 'right', sortValue: (r) => r.totalPaise,
      cell: (r) => <Money value={r.totalPaise} />,
    },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) =>
        r.status === 'not_generated' && canGenerate ? (
          <Button
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              setTarget(r);
              setDistance(100);
            }}
          >
            Generate
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="E-way bills"
        description="Goods worth more than ₹50,000 cannot move without one. Services never need one, because nothing travels."
      />

      <AsyncPage state={state}>
        {(d) => (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Needing a bill"
                value={String(needed.length)}
                sub={formatINRCompact(needed.reduce((t, r) => t + r.totalPaise, 0))}
                icon={Truck}
                tone={needed.length ? 'warning' : 'positive'}
              />
              <StatTile
                label="Generated"
                value={String(generated.length)}
                sub={formatINRCompact(generated.reduce((t, r) => t + r.totalPaise, 0))}
                tone="positive"
              />
              <StatTile
                label="Expired"
                value={String(expired.length)}
                sub="Still in transit is a detention risk"
                tone={expired.length ? 'danger' : 'default'}
              />
            </div>

            {d.ewayBills.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No consignments above the threshold"
                description="Only goods invoices over ₹50,000 need an e-way bill."
              />
            ) : (
              <DataTable
                rows={d.ewayBills}
                columns={columns}
                getRowId={(r) => r.invoiceId}
                initialSort={{ key: 'date', dir: 'desc' }}
                searchPlaceholder="Search invoice, customer or vehicle…"
              />
            )}
          </>
        )}
      </AsyncPage>

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate e-way bill for {target?.number}</DialogTitle>
            <DialogDescription>
              Validity is one day per 200 km, minimum one day, counted from now. Getting the distance wrong is the
              usual reason a bill expires with the lorry still on the road.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Vehicle number">
                <Input
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                  placeholder="AA00AA0000"
                  className="font-mono"
                />
              </Field>
              <Field label="Distance (km)" required>
                <Input
                  type="number"
                  min="1"
                  value={distance}
                  onChange={(e) => setDistance(Math.max(1, Number(e.target.value) || 1))}
                />
              </Field>
            </div>
            <Field label="Transporter">
              <Input
                value={transporter}
                onChange={(e) => setTransporter(e.target.value)}
                placeholder="Transporter name"
              />
            </Field>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Consignment value <Money value={target?.totalPaise ?? 0} className="font-medium text-foreground" /> ·
              valid for {Math.max(1, Math.ceil(distance / 200))} day
              {Math.max(1, Math.ceil(distance / 200)) === 1 ? '' : 's'}
            </div>
            {generate.error && <p className="text-sm text-destructive">{generate.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={submit} disabled={generate.busy}>
              {generate.busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              {generate.busy ? 'Generating…' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
