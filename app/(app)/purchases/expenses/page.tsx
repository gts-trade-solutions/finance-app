'use client';

import { useState } from 'react';
import { CreditCard, Paperclip, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { EmptyState } from '@/components/shared/empty-state';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { useAppStore } from '@/lib/store';
import { Combobox } from '@/components/ui/combobox';
import { accountOptions, bankAccountOptions, customerOptions, vendorOptions } from '@/lib/options';
import { usePermission } from '@/lib/store/hooks';
import { today } from '@/lib/selectors';
import { createExpense } from '@/lib/services/purchases';
import { GST_RATES } from '@/lib/tax/gst';
import type { Expense } from '@/lib/types';

export default function ExpensesPage() {
  const s = useAppStore();
  const canCreate = usePermission('purchases', 'create');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    accountId: '', vendorId: '', paidThroughId: s.bankAccounts[0]?.id ?? '',
    amount: 0, gst: 18, notes: '', billable: false, customerId: '',
  });

  const save = () => {
    if (!f.accountId || f.amount <= 0) { toast.error('Pick a category and enter an amount.'); return; }
    const e = createExpense({
      branchId: s.activeBranchId,
      date: today(),
      accountId: f.accountId,
      vendorId: f.vendorId || null,
      paidThroughId: f.paidThroughId,
      amountPaise: f.amount,
      gstRatePct: f.gst,
      isBillable: f.billable,
      customerId: f.customerId || undefined,
      notes: f.notes,
      receiptAttached: true,
    });
    toast.success(`Expense ${e.number} recorded`);
    setOpen(false);
    setF({ ...f, amount: 0, notes: '', billable: false, customerId: '' });
  };

  const columns: Column<Expense>[] = [
    { key: 'number', header: 'Expense #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) },
    {
      key: 'category',
      header: 'Category',
      sortValue: (r) => s.accounts.find((a) => a.id === r.accountId)?.name ?? '',
      cell: (r) => s.accounts.find((a) => a.id === r.accountId)?.name ?? '—',
    },
    { key: 'notes', header: 'Description', sortValue: (r) => r.notes, cell: (r) => <span className="text-sm text-muted-foreground">{r.notes}</span> },
    {
      key: 'paid',
      header: 'Paid through',
      sortValue: (r) => s.bankAccounts.find((b) => b.id === r.paidThroughId)?.name ?? '',
      cell: (r) => <span className="text-xs">{s.bankAccounts.find((b) => b.id === r.paidThroughId)?.name}</span>,
    },
    {
      key: 'flags',
      header: '',
      cell: (r) => (
        <div className="flex gap-1">
          {r.receiptAttached && <Paperclip className="size-3.5 text-muted-foreground" />}
          {r.isBillable && <Badge variant="outline" className="text-[10px]">Billable</Badge>}
        </div>
      ),
    },
    { key: 'itc', header: 'ITC', align: 'right', sortValue: (r) => r.tax.cgstPaise + r.tax.igstPaise, cell: (r) => <Money value={r.tax.cgstPaise + r.tax.sgstPaise + r.tax.igstPaise} showZero={false} className="text-muted-foreground" /> },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => r.amountPaise, cell: (r) => <Money value={r.amountPaise} className="font-medium" /> },
  ];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Direct spending that doesn't need a vendor bill — fuel, utilities, subscriptions."
        actions={
          canCreate && (
            <>
              <Button variant="outline" size="sm" asChild className="gap-1.5">
                <Link href="/ai"><Sparkles className="size-3.5" /> Scan a receipt</Link>
              </Button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New expense</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Record expense</DialogTitle></DialogHeader>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Category" required className="sm:col-span-2">
                      <Combobox
                        options={accountOptions(s, ['expense'])}
                        value={f.accountId}
                        onChange={(v) => setF({ ...f, accountId: v })}
                        placeholder="Select expense account"
                        searchPlaceholder="Search accounts by name or code"
                        showAvatar={false}
                      />
                    </Field>
                    <Field label="Amount (before GST)" required>
                      <MoneyInput valuePaise={f.amount} onChangePaise={(p) => setF({ ...f, amount: p })} />
                    </Field>
                    <Field label="GST rate" hint="Claimable as input credit">
                      <Combobox
                        options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))}
                        value={String(f.gst)}
                        onChange={(v) => setF({ ...f, gst: Number(v) })}
                        showAvatar={false}
                        searchPlaceholder="Rate"
                      />
                    </Field>
                    <Field label="Paid through" required>
                      <Combobox
                        options={bankAccountOptions(s)}
                        value={f.paidThroughId}
                        onChange={(v) => setF({ ...f, paidThroughId: v })}
                        placeholder="Select account"
                        searchPlaceholder="Search accounts"
                      />
                    </Field>
                    <Field label="Vendor" hint="Optional">
                      <Combobox
                        options={vendorOptions(s)}
                        value={f.vendorId}
                        onChange={(v) => setF({ ...f, vendorId: v })}
                        placeholder="None"
                        searchPlaceholder="Search vendors"
                        clearable
                      />
                    </Field>
                    <Field label="Description" className="sm:col-span-2">
                      <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="EB bill — Guindy godown" />
                    </Field>
                    <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
                      <div>
                        <p className="text-sm font-medium">Rebill to a customer</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Pulls onto their next invoice automatically</p>
                      </div>
                      <Switch checked={f.billable} onCheckedChange={(v) => setF({ ...f, billable: v })} />
                    </div>
                    {f.billable && (
                      <Field label="Customer" className="sm:col-span-2">
                        <Combobox
                          options={customerOptions(s)}
                          value={f.customerId}
                          onChange={(v) => setF({ ...f, customerId: v })}
                          placeholder="Select a customer"
                          searchPlaceholder="Search customers"
                          clearable
                        />
                      </Field>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button onClick={save}>Record expense</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )
        }
      />
      {s.expenses.length === 0 ? (
        <EmptyState icon={CreditCard} title="No expenses" description="Record day-to-day spending here." />
      ) : (
        <DataTable rows={s.expenses} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} searchPlaceholder="Search description or category…" />
      )}
    </>
  );
}
