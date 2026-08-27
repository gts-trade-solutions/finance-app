'use client';

import { useState } from 'react';
import { ArrowRight, FileText, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { useAppStore } from '@/lib/store';
import { Combobox } from '@/components/ui/combobox';
import { customerOptions, itemOptions } from '@/lib/options';
import { usePermission } from '@/lib/store/hooks';
import { contactName, today } from '@/lib/selectors';
import { convertEstimateToSO, createEstimate, setEstimateStatus } from '@/lib/services/sales';
import type { Estimate } from '@/lib/types';

export default function EstimatesPage() {
  const s = useAppStore();
  const canCreate = usePermission('sales', 'create');
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState(1);
  const [rate, setRate] = useState(0);

  const save = () => {
    if (!customerId || !itemId) { toast.error('Pick a customer and an item.'); return; }
    const expiry = new Date(today());
    expiry.setDate(expiry.getDate() + 15);
    const est = createEstimate({
      branchId: s.activeBranchId,
      customerId,
      date: today(),
      expiryDate: expiry.toISOString().slice(0, 10),
      lines: [{ itemId, qty, ratePaise: rate }],
    });
    toast.success(`Estimate ${est.number} created`, { description: 'Nothing posts to the ledger — a quote is not yet a sale.' });
    setOpen(false);
  };

  const columns: Column<Estimate>[] = [
    { key: 'number', header: 'Estimate #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customer', header: 'Customer', sortValue: (r) => contactName(s, r.customerId), cell: (r) => contactName(s, r.customerId) },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    { key: 'expiry', header: 'Valid until', sortValue: (r) => r.expiryDate, cell: (r) => new Date(r.expiryDate).toLocaleDateString('en-IN') },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', header: 'Total', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        r.status === 'converted' ? (
          <span className="text-xs text-muted-foreground">Converted</span>
        ) : (
          <div className="flex justify-end gap-1.5">
            {r.status !== 'accepted' && (
              <Button variant="outline" size="xs" onClick={() => { setEstimateStatus(r.id, 'accepted'); toast.success('Marked accepted'); }}>
                Accept
              </Button>
            )}
            <Button
              size="xs"
              className="gap-1"
              onClick={() => {
                const so = convertEstimateToSO(r.id);
                toast.success(`Converted to sales order ${so.number}`);
              }}
            >
              To order <ArrowRight className="size-3" />
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Estimates & quotes"
        description="A quote is a promise, not a sale — nothing touches the ledger until it becomes an invoice."
        actions={
          canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New estimate</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New estimate</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <Field label="Customer" required>
                    <Combobox
                      options={customerOptions(s)}
                      value={customerId}
                      onChange={setCustomerId}
                      placeholder="Select a customer"
                      searchPlaceholder="Search customers"
                      clearable
                    />
                  </Field>
                  <Field label="Item" required>
                    <Combobox
                      options={itemOptions(s)}
                      value={itemId}
                      onChange={(v) => {
                        setItemId(v);
                        setRate(s.items.find((i) => i.id === v)?.salePricePaise ?? 0);
                      }}
                      placeholder="Select an item"
                      searchPlaceholder="Search items by name, SKU or HSN"
                      showAvatar={false}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Quantity">
                      <Input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                    </Field>
                    <Field label="Rate">
                      <MoneyInput valuePaise={rate} onChangePaise={setRate} />
                    </Field>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save}>Create estimate</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />
      {s.estimates.length === 0 ? (
        <EmptyState icon={FileText} title="No estimates" description="Send a quote before committing to an invoice." />
      ) : (
        <DataTable rows={s.estimates} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} />
      )}
    </>
  );
}
