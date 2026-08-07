'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { useAppStore, getState, setState } from '@/lib/store';
import { useCanSeeCosts, usePermission } from '@/lib/store/hooks';
import { GST_RATES } from '@/lib/tax/gst';
import { genId } from '@/lib/ledger/posting';
import { logAudit } from '@/lib/services/audit';
import { ACC } from '@/lib/mock/seed/accounts';
import type { Item } from '@/lib/types';

export default function ItemsPage() {
  const s = useAppStore();
  const canCreate = usePermission('sales', 'create');
  const canSeeCosts = useCanSeeCosts();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', sku: '', hsnSac: '', kind: 'goods' as 'goods' | 'service',
    uqc: 'NOS', salePrice: 0, purchasePrice: 0, gstRatePct: 18,
  });

  const save = () => {
    if (!form.name.trim()) { toast.error('Item name is required'); return; }
    const item: Item = {
      id: genId('i'),
      kind: form.kind,
      name: form.name,
      sku: form.sku,
      hsnSac: form.hsnSac,
      uqc: form.uqc,
      salePricePaise: form.salePrice,
      purchasePricePaise: form.purchasePrice,
      gstRatePct: form.gstRatePct,
      taxPref: 'taxable',
      saleAccountId: form.kind === 'service' ? ACC.SERVICE_INCOME : ACC.SALES,
      purchaseAccountId: ACC.PURCHASES,
      isArchived: false,
      trackInventory: form.kind === 'goods',
      openingStockQty: 0,
      reorderLevel: 5,
    };
    setState({ items: [item, ...getState().items] });
    logAudit('create', 'item', item.id, item.name, `${form.kind} · HSN ${form.hsnSac} · GST ${form.gstRatePct}%`);
    toast.success(`${form.name} added`);
    setOpen(false);
    setForm({ name: '', sku: '', hsnSac: '', kind: 'goods', uqc: 'NOS', salePrice: 0, purchasePrice: 0, gstRatePct: 18 });
  };

  const columns: Column<Item>[] = [
    {
      key: 'name',
      header: 'Item',
      sortValue: (r) => r.name,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-muted-foreground">{r.sku}</p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      sortValue: (r) => r.kind,
      cell: (r) => <Badge variant="secondary" className="capitalize text-[10px]">{r.kind}</Badge>,
    },
    { key: 'hsn', header: 'HSN/SAC', sortValue: (r) => r.hsnSac, cell: (r) => <span className="font-mono text-xs">{r.hsnSac}</span> },
    { key: 'uqc', header: 'Unit', sortValue: (r) => r.uqc, cell: (r) => <span className="text-xs">{r.uqc}</span> },
    { key: 'gst', header: 'GST', align: 'right', sortValue: (r) => r.gstRatePct, cell: (r) => <span className="tabular">{r.gstRatePct}%</span> },
    ...(canSeeCosts
      ? [{
          key: 'cost',
          header: 'Cost price',
          align: 'right' as const,
          sortValue: (r: Item) => r.purchasePricePaise,
          cell: (r: Item) => <Money value={r.purchasePricePaise} className="text-muted-foreground" />,
        }]
      : []),
    { key: 'price', header: 'Sale price', align: 'right', sortValue: (r) => r.salePricePaise, cell: (r) => <Money value={r.salePricePaise} className="font-medium" /> },
  ];

  return (
    <>
      <PageHeader
        title="Items & services"
        description={
          canSeeCosts
            ? 'HSN/SAC codes and GST rates flow automatically onto every invoice and bill.'
            : 'Cost prices are hidden for your role.'
        }
        actions={
          canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New item</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>New item</DialogTitle></DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" required className="sm:col-span-2">
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Brake Pad Set" />
                  </Field>
                  <Field label="Type">
                    <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as 'goods' | 'service' })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="goods">Goods</SelectItem>
                        <SelectItem value="service">Service</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="SKU">
                    <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="BP-SW-101" />
                  </Field>
                  <Field label={form.kind === 'goods' ? 'HSN code' : 'SAC code'}>
                    <Input value={form.hsnSac} onChange={(e) => setForm({ ...form, hsnSac: e.target.value })} placeholder="8708" className="font-mono" />
                  </Field>
                  <Field label="Unit (UQC)">
                    <Input value={form.uqc} onChange={(e) => setForm({ ...form, uqc: e.target.value })} placeholder="NOS" />
                  </Field>
                  <Field label="Sale price">
                    <MoneyInput valuePaise={form.salePrice} onChangePaise={(p) => setForm({ ...form, salePrice: p })} />
                  </Field>
                  <Field label="Purchase price">
                    <MoneyInput valuePaise={form.purchasePrice} onChangePaise={(p) => setForm({ ...form, purchasePrice: p })} />
                  </Field>
                  <Field label="GST rate" className="sm:col-span-2">
                    <Select value={String(form.gstRatePct)} onValueChange={(v) => setForm({ ...form, gstRatePct: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save}>Save item</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />
      <DataTable
        rows={s.items.filter((i) => !i.isArchived)}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search item, SKU or HSN…"
        emptyMessage="No items yet."
      />
    </>
  );
}
