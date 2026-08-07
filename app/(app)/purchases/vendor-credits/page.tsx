'use client';

import { useState } from 'react';
import { FileMinus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { contactName, today, vendors } from '@/lib/selectors';
import { createVendorCredit } from '@/lib/services/purchases';
import type { VendorCredit } from '@/lib/types';

const REASONS = [
  'Goods returned to supplier',
  'Short supply / quantity shortfall',
  'Damaged goods received',
  'Rate difference agreed',
  'Duplicate billing by vendor',
];

export default function VendorCreditsPage() {
  const s = useAppStore();
  const canCreate = usePermission('purchases', 'create');
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [billId, setBillId] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [amount, setAmount] = useState(0);

  const vendorBills = s.bills.filter((b) => b.vendorId === vendorId && b.status !== 'void');

  const save = () => {
    if (!vendorId || amount <= 0) { toast.error('Pick a vendor and enter an amount.'); return; }
    const vc = createVendorCredit({
      branchId: s.activeBranchId,
      vendorId,
      date: today(),
      reason,
      againstBillId: billId || null,
      amountPaise: amount,
    });
    toast.success(`Vendor credit ${vc.number} created`, { description: 'Reduces what you owe this vendor.' });
    setOpen(false);
    setAmount(0);
  };

  const columns: Column<VendorCredit>[] = [
    { key: 'number', header: 'Credit #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'vendor', header: 'Vendor', sortValue: (r) => contactName(s, r.vendorId), cell: (r) => contactName(s, r.vendorId) },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    { key: 'reason', header: 'Reason', sortValue: (r) => r.reason, cell: (r) => <span className="text-xs text-muted-foreground">{r.reason}</span> },
    {
      key: 'against',
      header: 'Against bill',
      sortValue: (r) => r.againstBillId ?? '',
      cell: (r) => <span className="text-xs">{s.bills.find((b) => b.id === r.againstBillId)?.internalNo ?? 'Standalone'}</span>,
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', header: 'Amount', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} className="font-medium" /> },
  ];

  return (
    <>
      <PageHeader
        title="Vendor credits"
        description="Money a supplier owes you back — returns, shortfalls, or over-billing."
        actions={
          canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New vendor credit</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New vendor credit</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <Field label="Vendor" required>
                    <Select value={vendorId} onValueChange={setVendorId}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {vendors(s).map((v) => <SelectItem key={v.id} value={v.id}>{v.displayName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Against bill" hint="Optional">
                    <Select value={billId} onValueChange={setBillId}>
                      <SelectTrigger><SelectValue placeholder="Standalone" /></SelectTrigger>
                      <SelectContent>
                        {vendorBills.map((b) => <SelectItem key={b.id} value={b.id}>{b.internalNo} — {b.number}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Reason" required>
                    <Select value={reason} onValueChange={setReason}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Amount" required>
                    <MoneyInput valuePaise={amount} onChangePaise={setAmount} />
                  </Field>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save}>Create credit</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />
      {s.vendorCredits.length === 0 ? (
        <EmptyState icon={FileMinus} title="No vendor credits" description="Raise one when you return goods or a supplier over-bills you." />
      ) : (
        <DataTable rows={s.vendorCredits} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} />
      )}
    </>
  );
}
