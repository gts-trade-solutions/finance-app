'use client';

// E-way bills.
//
// Goods worth more than ₹50,000 cannot legally move without one. Services do
// not move, so they never need one — which is why this list is filtered to
// goods consignments above the threshold rather than to every invoice.
//
// Validity is one day per 200 km, minimum one day, counted from when Part B —
// the vehicle — is entered, and running to midnight of the last day. An
// expired bill on a lorry that is still in transit is a detention risk, so the
// expiry is shown rather than buried.

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
import { cn } from '@/lib/utils';

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
  // Listed and *required* are different things. Every goods document over
  // ₹50,000 is listed, but a state may set a higher intra-state threshold, so
  // some of those rows need nothing. Counting them as outstanding would put a
  // permanent warning tile in front of somebody with nothing to do.
  const needed = rows.filter((r) => r.status === 'not_generated' && r.required);
  const expired = generated.filter((r) => r.validUntil && r.validUntil < today());
  const blocked = rows.filter((r) => r.blockers.length > 0);

  const submit = async () => {
    if (!target) return;
    const done = await generate.run({
      // A challan carries no invoice id, so the row says which it is.
      ...(target.docKind === 'invoice'
        ? { invoiceId: target.docId }
        : { challanId: target.docId }),
      vehicleNo: vehicleNo || null,
      transporterName: transporter || null,
      distanceKm: distance,
    });
    if (!done) {
      toast.error(generate.error ?? 'The e-way bill was not generated');
      return;
    }
    const days = Math.max(1, Math.ceil(distance / 200));
    toast.success(`E-way bill ${done.ewayBillNo} generated`, {
      description:
        `Valid ${days} day${days === 1 ? '' : 's'} — one per 200 km — until ` +
        `${done.validUntil.slice(0, 16)}.` +
        (done.live ? '' : ' Nothing was filed with any portal: no GSP is connected.'),
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
        ) : r.required ? (
          <Badge variant="outline" className="border-amber-500/40 text-[10px]">Needed</Badge>
        ) : (
          // Listed because it is over ₹50,000, but under this state's own
          // limit. Saying "Needed" here contradicted the column beside it.
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'invoice', header: 'Document', sortValue: (r) => r.number,
      cell: (r) => (
        // The reason sits under the document rather than in a column of its
        // own. As a separate column it pushed the Generate button off the edge
        // of an ordinary laptop screen — the one action this page exists for.
        // The cells are nowrap, right for figures and wrong for a sentence,
        // hence the override.
        <div className="w-[18rem] whitespace-normal">
          <div className="flex items-center gap-1.5">
            <p className="font-medium">{r.number}</p>
            {/* A challan is the case people miss — worth saying so on the row. */}
            {r.docKind === 'challan' && (
              <Badge variant="outline" className="text-[9px]">Challan</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{r.customerName}</p>
          <p
            className={cn(
              'mt-1 text-xs leading-snug',
              r.required ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
            )}
          >
            {r.requirementReason}
          </p>
          {r.blockers.map((b) => (
            <p key={b} className="mt-1 text-xs leading-snug text-destructive">{b}</p>
          ))}
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
            // Blocked means the portal will refuse it — a document past 180
            // days can never carry a bill, so offering the button would be
            // offering something that cannot work.
            disabled={r.blockers.length > 0}
            variant={r.required ? 'default' : 'outline'}
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
        description={
          'Goods over ₹50,000 cannot move without one — and some states set a higher limit inside their ' +
          'own borders. Delivery challans are listed too: sending material out for job work is not a sale, ' +
          'but the lorry still has to be declared, and between states it needs a bill at any value.'
        }
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
                label={blocked.length ? 'Past 180 days' : 'Expired'}
                value={String(blocked.length || expired.length)}
                sub={
                  blocked.length
                    ? 'Too old to ever carry a bill'
                    : 'Still in transit is a detention risk'
                }
                tone={blocked.length || expired.length ? 'danger' : 'default'}
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
                // Invoice ids and challan ids are separate sequences, so the
                // kind has to be part of the key or two rows can collide.
                getRowId={(r) => `${r.docKind}:${r.docId}`}
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
              A vehicle number is Part B, and validity only starts counting once it is entered — one day per
              200 km, running to midnight of the last day. Getting the distance wrong is the usual reason a
              bill expires with the lorry still on the road.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Vehicle number" required hint="Part B — the bill authorises nothing without it">
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
