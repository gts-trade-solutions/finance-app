'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { Field, FormSection, MoneyInput, TotalRow } from '@/components/shared/form-bits';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { useAppStore } from '@/lib/store';
import { billBalance, today, vendors } from '@/lib/selectors';
import { makePayment } from '@/lib/services/purchases';
import type { PaymentAllocation, PaymentMode } from '@/lib/types';

const MODES: PaymentMode[] = ['neft', 'imps', 'upi', 'cheque', 'cash', 'card'];

function PayInner() {
  const router = useRouter();
  const params = useSearchParams();
  const s = useAppStore();
  const vendorList = vendors(s);

  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<PaymentMode>('neft');
  const [bankAccountId, setBankAccountId] = useState(s.bankAccounts[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});

  useEffect(() => {
    const billId = params.get('bill');
    if (!billId) return;
    const b = s.bills.find((x) => x.id === billId);
    if (!b) return;
    setVendorId(b.vendorId);
    setSelected({ [b.id]: billBalance(b) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, s.bills.length]);

  const openBills = useMemo(
    () =>
      s.bills
        .filter((b) => b.vendorId === vendorId && b.status !== 'void' && billBalance(b) > 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [s.bills, vendorId],
  );

  const vendor = vendorList.find((v) => v.id === vendorId);
  const total = Object.values(selected).reduce((t, v) => t + v, 0);

  const toggle = (id: string, bal: number) =>
    setSelected((sel) => {
      const next = { ...sel };
      if (next[id] != null) delete next[id];
      else next[id] = bal;
      return next;
    });

  const selectAll = () => {
    const all: Record<string, number> = {};
    openBills.forEach((b) => { all[b.id] = billBalance(b); });
    setSelected(all);
  };

  const save = () => {
    if (!vendorId || total <= 0) { toast.error('Pick a vendor and at least one bill.'); return; }
    const allocations: PaymentAllocation[] = Object.entries(selected).map(([targetId, amountPaise]) => ({
      targetType: 'bill', targetId, amountPaise,
    }));
    const p = makePayment({ vendorId, date, mode, bankAccountId, allocations, reference });
    toast.success(`Payment ${p.number} recorded`, {
      description: `${allocations.length} bill(s) settled. Payment advice sent to the vendor.`,
    });
    router.push('/purchases/payments');
  };

  return (
    <>
      <PageHeader
        title="Pay vendor"
        description="Settle several bills in one payment run. Oldest due dates first."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.back()}>Cancel</Button>
            <Button size="sm" onClick={save} className="gap-1.5"><Banknote className="size-3.5" /> Record payment</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <FormSection title="Payment details">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vendor" required>
                  <Select value={vendorId} onValueChange={(v) => { setVendorId(v); setSelected({}); }}>
                    <SelectTrigger><SelectValue placeholder="Select a vendor…" /></SelectTrigger>
                    <SelectContent>
                      {vendorList.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.displayName}{v.isMsme ? ' · MSME' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Payment date" required>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Mode">
                  <Select value={mode} onValueChange={(v) => setMode(v as PaymentMode)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODES.map((m) => <SelectItem key={m} value={m} className="uppercase">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Pay from">
                  <Select value={bankAccountId} onValueChange={setBankAccountId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {s.bankAccounts.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Reference" className="sm:col-span-2">
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
                </Field>
              </div>
            </FormSection>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Bills to pay</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {vendorId ? `${openBills.length} unpaid bill(s)` : 'Select a vendor first'}
                </p>
              </div>
              {openBills.length > 0 && (
                <Button variant="outline" size="sm" onClick={selectAll}>Select all</Button>
              )}
            </div>
            {openBills.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {vendorId ? 'Nothing outstanding for this vendor.' : 'No vendor selected.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border thin-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="w-10 px-3 py-2" />
                      <th className="px-3 py-2 text-left font-semibold">Bill</th>
                      <th className="px-3 py-2 text-left font-semibold">Due</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Balance</th>
                      <th className="px-3 py-2 text-right font-semibold">Paying</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openBills.map((b) => {
                      const bal = billBalance(b);
                      const isSel = selected[b.id] != null;
                      const overdue = b.dueDate < today();
                      return (
                        <tr key={b.id} className="border-b last:border-0">
                          <td className="px-3 py-2"><Checkbox checked={isSel} onCheckedChange={() => toggle(b.id, bal)} /></td>
                          <td className="px-3 py-2">
                            <p className="font-medium">{b.internalNo}</p>
                            <p className="text-xs text-muted-foreground">{b.number}</p>
                          </td>
                          <td className={`px-3 py-2 text-xs ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {new Date(b.dueDate).toLocaleDateString('en-IN')}
                          </td>
                          <td className="px-3 py-2"><StatusBadge status={overdue ? 'overdue' : b.status} /></td>
                          <td className="px-3 py-2 text-right"><Money value={bal} /></td>
                          <td className="px-3 py-2">
                            {isSel ? (
                              <MoneyInput
                                valuePaise={selected[b.id]}
                                onChangePaise={(p) => setSelected((sel) => ({ ...sel, [b.id]: Math.min(p, bal) }))}
                                className="h-8 w-32"
                              />
                            ) : (
                              <span className="block text-right text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div>
          <Card className="sticky top-20 space-y-3 p-5">
            <h3 className="text-sm font-semibold">Summary</h3>
            <TotalRow label="Bills selected">{Object.keys(selected).length}</TotalRow>
            <TotalRow label="Total payment" emphasis><Money value={total} /></TotalRow>

            {vendor?.isMsme && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">MSME vendor.</span> Paying within 45 days keeps
                    the expense deductible under Section 43B(h).
                  </p>
                </div>
              </div>
            )}

            {vendor && (
              <div className="rounded-md border p-3 text-xs">
                <p className="text-muted-foreground">Paying</p>
                <p className="mt-0.5 font-medium">{vendor.displayName}</p>
                {vendor.gstin && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{vendor.gstin}</p>}
                {vendor.tdsSection && (
                  <Badge variant="secondary" className="mt-2 text-[10px]">TDS {vendor.tdsSection} already withheld on bills</Badge>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

export default function PayVendorPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <PayInner />
    </Suspense>
  );
}
