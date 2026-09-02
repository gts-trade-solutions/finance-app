'use client';

// Purchase orders — commitments to buy.
//
// Nothing here is a payable. A supplier is owed when they have supplied
// something and sent a bill, not when we said we would like some. Converting an
// order to a bill is the moment the debt becomes real and the ledger hears
// about it.

import { useState } from 'react';
import { ArrowRight, ClipboardList, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { ContactPicker, QuickItemDialog } from '@/components/forms/quick-create';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { AsyncPage } from '@/components/shared/async-state';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { purchaseDocuments, type PurchaseDocListResponse, type PurchaseDocRow } from '@/lib/api/client';
import { useApi, useApiAction } from '@/lib/api/use-api';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { itemOptions } from '@/lib/options';

const today = () => new Date().toISOString().slice(0, 10);
const short = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const canCreate = usePermission('purchases', 'create');
  const branchId = useAppStore((s) => s.activeBranchId);
  const items = useAppStore((s) => s.items);

  const state = useApi<PurchaseDocListResponse>(() => purchaseDocuments.list('purchase-order'), []);

  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [itemId, setItemId] = useState('');
  // Non-null while the inline "New item" dialog is open.
  const [newItemName, setNewItemName] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [rate, setRate] = useState(0);
  const [expected, setExpected] = useState('');

  const [billing, setBilling] = useState<PurchaseDocRow | null>(null);
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('');

  const create = useApiAction(purchaseDocuments.create);
  const convert = useApiAction(purchaseDocuments.convert);

  const save = async () => {
    if (!vendorId || !itemId) {
      toast.error('Pick a vendor and an item.');
      return;
    }
    const result = await create.run({
      kind: 'purchase-order',
      branchId,
      vendorId,
      date: today(),
      expectedDate: expected || inDays(14),
      lines: [{ itemId, qty, ratePaise: rate }],
    });
    if (!result) return;
    toast.success(`${result.number} raised`, {
      description: 'Nothing posts yet — an order is a commitment, not a payable.',
    });
    setOpen(false);
    setVendorId('');
    setItemId('');
    setQty(1);
    setRate(0);
    state.refetch();
  };

  const toBill = async () => {
    if (!billing) return;
    if (!vendorInvoiceNo.trim()) {
      toast.error("The supplier's own invoice number is required — GSTR-2B is matched on it.");
      return;
    }
    const done = await convert.run(billing.id, vendorInvoiceNo.trim(), today(), inDays(30));
    if (!done) {
      toast.error(convert.error ?? 'Could not record the bill');
      return;
    }
    toast.success(`Bill ${done.internalNo} recorded`, { description: 'The payable is now on the books.' });
    setBilling(null);
    setVendorInvoiceNo('');
    router.push(`/purchases/bills/${done.billId}`);
  };

  const columns: Column<PurchaseDocRow>[] = [
    { key: 'number', header: 'PO #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'vendor', header: 'Vendor', sortValue: (r) => r.vendorName, cell: (r) => r.vendorName },
    { key: 'date', header: 'Issued', sortValue: (r) => r.date, cell: (r) => short(r.date) },
    { key: 'expected', header: 'Expected', sortValue: (r) => r.expected ?? '', cell: (r) => short(r.expected) },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'billed', header: 'Billed', align: 'right',
      sortValue: (r) => r.appliedPaise,
      cell: (r) => <Money value={r.appliedPaise} showZero={false} />,
    },
    { key: 'total', header: 'Order value', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} className="font-medium" /> },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) =>
        r.status === 'billed' ? (
          <span className="text-xs text-muted-foreground">Billed</span>
        ) : r.status === 'cancelled' ? (
          <span className="text-xs text-muted-foreground">Cancelled</span>
        ) : canCreate ? (
          <Button
            size="xs"
            className="gap-1"
            onClick={() => { setBilling(r); setVendorInvoiceNo(''); }}
          >
            Record bill <ArrowRight className="size-3" />
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Commitments to buy. Nothing hits the ledger until the goods arrive and the bill is recorded."
        actions={
          canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New purchase order</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New purchase order</DialogTitle>
                  <DialogDescription>
                    Rates default to what you normally pay for the item, not what you sell it for.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Field label="Vendor" required>
                    <ContactPicker
                      kind="vendor"
                      value={vendorId}
                      onChange={setVendorId}
                      canCreate={canCreate}
                    />
                  </Field>
                  <Field label="Item" required>
                    <Combobox
                      options={itemOptions({ items } as never, 'purchase')}
                      value={itemId}
                      onChange={(v) => {
                        setItemId(v);
                        setRate(items.find((i) => i.id === v)?.purchasePricePaise ?? 0);
                      }}
                      placeholder="Select an item"
                      searchPlaceholder="Search items by name, SKU or HSN"
                      showAvatar={false}
                      createLabel={canCreate ? 'New item' : undefined}
                      onCreate={canCreate ? (q) => setNewItemName(q) : undefined}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Quantity">
                      <Input
                        type="number"
                        min="1"
                        value={qty}
                        onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </Field>
                    <Field label="Rate">
                      <MoneyInput valuePaise={rate} onChangePaise={setRate} />
                    </Field>
                  </div>
                  <Field label="Expected delivery">
                    <Input type="date" value={expected || inDays(14)} onChange={(e) => setExpected(e.target.value)} />
                  </Field>
                  {create.error && <p className="text-sm text-destructive">{create.error}</p>}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save} disabled={create.busy}>
                    {create.busy ? 'Saving…' : 'Raise order'}
                  </Button>
                </DialogFooter>

                {/* The item is saved to the catalogue and then priced onto this order,
                    so its purchase price and HSN arrive exactly as a picked item's would. */}
                <QuickItemDialog
                  open={newItemName !== null}
                  onOpenChange={(o) => !o && setNewItemName(null)}
                  initialName={newItemName ?? ''}
                  priceMode="purchase"
                  onCreated={(item) => { setItemId(item.id); setRate(item.purchasePricePaise); }}
                />
              </DialogContent>
            </Dialog>
          )
        }
      />
      <AsyncPage state={state}>
        {(d) => (
          <>
            {d.summary.openPaise > 0 && (
              <p className="text-xs text-muted-foreground">
                <Money value={d.summary.openPaise} className="font-medium" /> on order and not yet billed —
                committed spend that is deliberately absent from the balance sheet.
              </p>
            )}
            {d.documents.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No purchase orders"
                description="Raise a PO to formalise what you've ordered."
              />
            ) : (
              <DataTable
                rows={d.documents}
                columns={columns}
                getRowId={(r) => r.id}
                initialSort={{ key: 'date', dir: 'desc' }}
                dateFilter={{ getDate: (r) => r.date }}
                searchPlaceholder="Search order or vendor…"
              />
            )}
          </>
        )}
      </AsyncPage>

      <Dialog open={!!billing} onOpenChange={(v) => !v && setBilling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record bill for {billing?.number}</DialogTitle>
            <DialogDescription>
              This is where the payable appears. The supplier&apos;s own invoice number is required —
              GSTR-2B is matched on it, not on our number.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Supplier's invoice number" required>
              <Input
                value={vendorInvoiceNo}
                onChange={(e) => setVendorInvoiceNo(e.target.value)}
                placeholder="Their order number"
                className="font-mono"
              />
            </Field>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Order value</span>
              <Money value={billing?.totalPaise ?? 0} className="font-semibold" />
            </div>
            {convert.error && <p className="text-sm text-destructive">{convert.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBilling(null)}>Cancel</Button>
            <Button onClick={toBill} disabled={convert.busy}>
              {convert.busy ? 'Recording…' : 'Record bill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
