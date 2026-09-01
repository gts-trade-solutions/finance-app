'use client';

// The item catalogue.
//
// The HSN/SAC field is a picker over the organisation's approved codes, not a
// text box. GSTR-1 Table 12 is validated against the government's master and a
// code that is not on it bounces the whole return — so the list an admin
// curates under Settings is the only thing an item can carry. Typing "8" lists
// every approved code starting 8, which is how people actually look these up.

import { useMemo, useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { EmptyState } from '@/components/shared/empty-state';
import { AsyncPage } from '@/components/shared/async-state';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { hsnCodes, items, type HsnCodeRow, type ItemRow } from '@/lib/api/client';
import { useApi, useApiAction } from '@/lib/api/use-api';
import { useCanSeeCosts, usePermission } from '@/lib/store/hooks';
import { GST_RATES } from '@/lib/tax/gst';

interface Loaded {
  items: ItemRow[];
  hsnCodes: HsnCodeRow[];
}

const BLANK = {
  name: '', sku: '', hsnSac: '', kind: 'goods' as 'goods' | 'service',
  uqc: 'NOS', salePrice: 0, purchasePrice: 0, gstRatePct: 18,
};

export default function ItemsPage() {
  const canCreate = usePermission('sales', 'create');
  const canSeeCosts = useCanSeeCosts();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);

  const state = useApi<Loaded>(
    async () => {
      const [i, h] = await Promise.all([items.list(), hsnCodes.list({ activeOnly: true })]);
      return { items: i.items, hsnCodes: h.hsnCodes };
    },
    [],
  );

  // A goods item takes an HSN, a service a SAC. Offering both invites the
  // classification error that puts a supply in the wrong GSTR-1 table.
  const codeOptions = useMemo(
    () =>
      (state.data?.hsnCodes ?? [])
        .filter((h) => (form.kind === 'service' ? h.kind === 'sac' : h.kind === 'hsn'))
        .map((h) => ({
          value: h.code,
          label: h.code,
          sublabel: h.description,
          meta: `${h.gstRatePct}%`,
        })),
    [state.data, form.kind],
  );

  const create = useApiAction(items.create);

  const save = async () => {
    if (!form.name.trim()) { toast.error('Item name is required'); return; }
    const result = await create.run({
      kind: form.kind,
      name: form.name.trim(),
      sku: form.sku || null,
      hsnSac: form.hsnSac || null,
      uqc: form.uqc || 'NOS',
      salePricePaise: form.salePrice,
      purchasePricePaise: form.purchasePrice,
      gstRatePct: form.gstRatePct,
      trackInventory: form.kind === 'goods',
    });
    if (!result) return;
    toast.success(`${result.name} added`);
    setOpen(false);
    setForm(BLANK);
    state.refetch();
  };

  const columns: Column<ItemRow>[] = [
    {
      key: 'name',
      header: 'Item',
      sortValue: (r) => r.name,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-muted-foreground">{r.sku ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      sortValue: (r) => r.kind,
      cell: (r) => <Badge variant="secondary" className="capitalize text-[10px]">{r.kind}</Badge>,
    },
    {
      key: 'hsn',
      header: 'HSN/SAC',
      sortValue: (r) => r.hsnSac ?? '',
      cell: (r) => <span className="font-mono text-xs">{r.hsnSac ?? '—'}</span>,
    },
    { key: 'uqc', header: 'Unit', sortValue: (r) => r.uqc, cell: (r) => <span className="text-xs">{r.uqc}</span> },
    {
      key: 'gst', header: 'GST', align: 'right',
      sortValue: (r) => r.gstRatePct,
      cell: (r) => <span className="tabular">{r.gstRatePct}%</span>,
    },
    {
      key: 'sold', header: 'Sold', align: 'right',
      sortValue: (r) => r.qtySold,
      cell: (r) => (
        <span className="tabular text-xs text-muted-foreground">
          {r.qtySold > 0 ? `${r.qtySold} ${r.uqc.toLowerCase()}` : '—'}
        </span>
      ),
    },
    ...(canSeeCosts
      ? [{
          key: 'cost',
          header: 'Cost price',
          align: 'right' as const,
          sortValue: (r: ItemRow) => r.purchasePricePaise,
          cell: (r: ItemRow) => <Money value={r.purchasePricePaise} className="text-muted-foreground" />,
        }]
      : []),
    {
      key: 'price', header: 'Sale price', align: 'right',
      sortValue: (r) => r.salePricePaise,
      cell: (r) => <Money value={r.salePricePaise} className="font-medium" />,
    },
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
                  <Field label="Name" required error={create.fieldErrors.name} className="sm:col-span-2">
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Item name"
                    />
                  </Field>
                  <Field label="Type">
                    <Select
                      value={form.kind}
                      onValueChange={(v) => setForm({ ...form, kind: v as 'goods' | 'service', hsnSac: '' })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="goods">Goods</SelectItem>
                        <SelectItem value="service">Service</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="SKU">
                    <Input
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                      placeholder="SKU-0001"
                    />
                  </Field>
                  <Field
                    label={form.kind === 'goods' ? 'HSN code' : 'SAC code'}
                    hint="Only codes an admin has approved"
                    error={create.fieldErrors.hsnSac}
                  >
                    <Combobox
                      options={codeOptions}
                      value={form.hsnSac}
                      onChange={(v) => {
                        const picked = state.data?.hsnCodes.find((h) => h.code === v);
                        setForm({
                          ...form,
                          hsnSac: v,
                          gstRatePct: picked ? picked.gstRatePct : form.gstRatePct,
                          uqc: picked?.uqc || form.uqc,
                        });
                      }}
                      placeholder={form.kind === 'goods' ? 'Type 8 for 8xxx…' : 'Type 99…'}
                      searchPlaceholder="Type the first digits"
                      matchMode="prefix"
                      showAvatar={false}
                      clearable
                    />
                  </Field>
                  <Field label="Unit (UQC)">
                    <Input
                      value={form.uqc}
                      onChange={(e) => setForm({ ...form, uqc: e.target.value })}
                      placeholder="NOS"
                    />
                  </Field>
                  <Field label="Sale price" error={create.fieldErrors.salePricePaise}>
                    <MoneyInput
                      valuePaise={form.salePrice}
                      onChangePaise={(p) => setForm({ ...form, salePrice: p })}
                    />
                  </Field>
                  <Field label="Purchase price">
                    <MoneyInput
                      valuePaise={form.purchasePrice}
                      onChangePaise={(p) => setForm({ ...form, purchasePrice: p })}
                    />
                  </Field>
                  <Field label="GST rate" className="sm:col-span-2">
                    <Select
                      value={String(form.gstRatePct)}
                      onValueChange={(v) => setForm({ ...form, gstRatePct: Number(v) })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  {create.error && <p className="text-sm text-destructive sm:col-span-2">{create.error}</p>}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save} disabled={create.busy}>
                    {create.busy ? 'Saving…' : 'Save item'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />
      <AsyncPage state={state}>
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState icon={Package} title="No items yet" description="Add what you sell to speed up invoicing." />
          ) : (
            <DataTable
              rows={d.items}
              columns={columns}
              getRowId={(r) => r.id}
              searchPlaceholder="Search item, SKU or HSN…"
              emptyMessage="No items match."
            />
          )
        }
      </AsyncPage>
    </>
  );
}
