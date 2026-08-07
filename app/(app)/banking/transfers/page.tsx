'use client';

import { useState } from 'react';
import { ArrowLeftRight, ArrowRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { Money } from '@/components/shared/money';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { today } from '@/lib/selectors';
import { createTransfer } from '@/lib/services/banking';

export default function TransfersPage() {
  const s = useAppStore();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(s.bankAccounts[0]?.id ?? '');
  const [to, setTo] = useState(s.bankAccounts[1]?.id ?? '');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());

  const transfers = s.entries.filter((e) => e.sourceType === 'transfer');

  const save = () => {
    if (from === to) { toast.error('Choose two different accounts.'); return; }
    if (amount <= 0) { toast.error('Enter an amount.'); return; }
    createTransfer({ fromBankAccountId: from, toBankAccountId: to, date, amountPaise: amount });
    toast.success('Transfer recorded', { description: 'Money moved between your own accounts — no income, no expense.' });
    setOpen(false);
    setAmount(0);
  };

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Moving money between your own accounts changes where it sits, not how much you have — so it never touches profit."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New transfer</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New transfer</DialogTitle>
                <DialogDescription>Between your own bank, cash or card accounts.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Field label="From account" required>
                  <Select value={from} onValueChange={setFrom}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {s.bankAccounts.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="To account" required>
                  <Select value={to} onValueChange={setTo}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {s.bankAccounts.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Amount" required>
                    <MoneyInput valuePaise={amount} onChangePaise={setAmount} />
                  </Field>
                  <Field label="Date" required>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={save}>Record transfer</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {transfers.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No transfers" description="Record cash withdrawals, deposits or inter-account movements." />
      ) : (
        <div className="space-y-3">
          {transfers.map((e) => {
            const debit = e.lines.find((l) => l.debit > 0);
            const credit = e.lines.find((l) => l.credit > 0);
            const fromAcc = s.accounts.find((a) => a.id === credit?.accountId);
            const toAcc = s.accounts.find((a) => a.id === debit?.accountId);
            return (
              <Card key={e.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="truncate text-sm font-medium">{fromAcc?.name}</span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{toAcc?.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <Money value={debit?.debit ?? 0} className="font-medium" />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
