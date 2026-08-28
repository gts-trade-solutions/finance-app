'use client';

import { useState } from 'react';
import { FileMinus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { useAppStore } from '@/lib/store';
import { Combobox } from '@/components/ui/combobox';
import { customerOptions } from '@/lib/options';
import { formatINR } from '@/lib/money';
import { usePermission } from '@/lib/store/hooks';
import { contactName, today } from '@/lib/selectors';
import { createCreditNote } from '@/lib/services/sales';
import type { CreditNote } from '@/lib/types';

// GST requires a reason on every credit note
const REASONS = [
  'Goods returned — damaged in transit',
  'Goods returned — wrong item supplied',
  'Post-sale discount agreed',
  'Deficiency in service',
  'Correction of taxable value',
  'Order cancelled',
];

export default function CreditNotesPage() {
  const s = useAppStore();
  const canCreate = usePermission('sales', 'create');
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [amount, setAmount] = useState(0);
  const [gstRate, setGstRate] = useState(18);

  const custInvoices = s.invoices.filter((i) => i.customerId === customerId && i.status !== 'void');

  const save = () => {
    if (!customerId || amount <= 0) { toast.error('Pick a customer and enter an amount.'); return; }
    const cn = createCreditNote({
      branchId: s.activeBranchId,
      customerId,
      date: today(),
      reason,
      againstInvoiceId: invoiceId || null,
      lines: [{ itemId: null, description: reason, qty: 1, ratePaise: amount, gstRatePct: gstRate }],
    });
    toast.success(`Credit note ${cn.number} created`, { description: 'Reduces the customer balance and reverses the GST.' });
    setOpen(false);
    setCustomerId(''); setInvoiceId(''); setAmount(0);
  };

  const columns: Column<CreditNote>[] = [
    { key: 'number', header: 'Credit note #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customer', header: 'Customer', sortValue: (r) => contactName(s, r.customerId), cell: (r) => contactName(s, r.customerId) },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    { key: 'reason', header: 'Reason', sortValue: (r) => r.reason, cell: (r) => <span className="text-xs text-muted-foreground">{r.reason}</span> },
    {
      key: 'against',
      header: 'Against',
      sortValue: (r) => r.againstInvoiceId ?? '',
      cell: (r) => {
        const inv = s.invoices.find((i) => i.id === r.againstInvoiceId);
        return <span className="text-xs">{inv?.number ?? 'Standalone'}</span>;
      },
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', header: 'Amount', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} className="font-medium" /> },
  ];

  return (
    <>
      <PageHeader
        title="Credit notes"
        description="The lawful way to reduce an invoice — the original stays untouched and a reversing entry is posted."
        actions={
          canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New credit note</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New credit note</DialogTitle>
                  <DialogDescription>GST law requires a reason code on every credit note.</DialogDescription>
                </DialogHeader>
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
                  <Field label="Against invoice" hint="Optional — leave blank for a standalone credit">
                    <Combobox
                      options={custInvoices.map((i) => ({
                        value: i.id,
                        label: i.number,
                        sublabel: new Date(i.date).toLocaleDateString('en-IN'),
                        meta: formatINR(i.totalPaise),
                      }))}
                      value={invoiceId}
                      onChange={setInvoiceId}
                      placeholder="Standalone credit note"
                      searchPlaceholder="Search invoices"
                      showAvatar={false}
                      clearable
                    />
                  </Field>
                  <Field label="Reason" required>
                    <Combobox
                      options={REASONS.map((r) => ({ value: r, label: r }))}
                      value={reason}
                      onChange={setReason}
                      showAvatar={false}
                      searchPlaceholder="Search reasons"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Taxable amount" required>
                      <MoneyInput valuePaise={amount} onChangePaise={setAmount} />
                    </Field>
                    <Field label="GST rate">
                      <Combobox
                        options={[0, 5, 12, 18, 28].map((r) => ({ value: String(r), label: `${r}%` }))}
                        value={String(gstRate)}
                        onChange={(v) => setGstRate(Number(v))}
                        showAvatar={false}
                        searchPlaceholder="Rate"
                      />
                    </Field>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save}>Create credit note</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />
      {s.creditNotes.length === 0 ? (
        <EmptyState icon={FileMinus} title="No credit notes" description="Issue one when goods come back or a discount is agreed after invoicing." />
      ) : (
        <DataTable rows={s.creditNotes} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} dateFilter={{ getDate: (r) => r.date }} />
      )}
    </>
  );
}
