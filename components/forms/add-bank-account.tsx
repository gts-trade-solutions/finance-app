'use client';

// "Add Bank or Credit Card" — the Zoho flow that was missing entirely. An
// account here is only half the picture: it also needs a ledger account, or
// nothing it does can be posted. The service creates both.

import { useState } from 'react';
import { Banknote, CreditCard, Landmark, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { createBankAccount } from '@/lib/services/banking';
import { today } from '@/lib/selectors';
import { cn } from '@/lib/utils';
import type { BankAccount } from '@/lib/types';

const KINDS: { value: BankAccount['kind']; label: string; icon: typeof Landmark; hint: string }[] = [
  { value: 'bank', label: 'Bank', icon: Landmark, hint: 'Current or savings account' },
  { value: 'card', label: 'Credit Card', icon: CreditCard, hint: 'Money you owe the issuer' },
  { value: 'cash', label: 'Cash', icon: Wallet, hint: 'Petty cash or till' },
  { value: 'clearing', label: 'Payment Clearing', icon: Banknote, hint: 'Collected, not yet deposited' },
];

export function AddBankAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [kind, setKind] = useState<BankAccount['kind']>('bank');
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [opening, setOpening] = useState(0);
  const [openingDate, setOpeningDate] = useState(today());
  const [isPrimary, setIsPrimary] = useState(false);
  const [feed, setFeed] = useState(false);

  const isCard = kind === 'card';
  const needsBankFields = kind === 'bank' || kind === 'card';

  const reset = () => {
    setKind('bank'); setName(''); setBankName(''); setAccountNumber('');
    setIfsc(''); setOpening(0); setIsPrimary(false); setFeed(false);
  };

  const save = () => {
    if (!name.trim()) {
      toast.error('Give the account a name');
      return;
    }
    const acct = createBankAccount({
      kind,
      name: name.trim(),
      bankName: bankName.trim() || undefined,
      accountNumber: accountNumber.trim() || undefined,
      ifsc: ifsc.trim() || undefined,
      openingBalancePaise: opening,
      openingDate,
      isPrimary,
      feedConnected: feed,
    });
    toast.success(`${acct.name} added`, {
      description: opening
        ? 'A ledger account was created and the opening balance posted against capital.'
        : 'A matching ledger account was created so this account can be posted to.',
    });
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Bank or Credit Card</DialogTitle>
          <DialogDescription>
            Creates the account and its matching ledger account together.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Account type */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={cn(
                  'flex flex-col items-start gap-1.5 rounded-md border p-2.5 text-left transition-colors',
                  kind === k.value
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/40 hover:bg-accent',
                )}
              >
                <k.icon className={cn('size-4', kind === k.value ? 'text-primary' : 'text-muted-foreground')} />
                <span className="text-[13px] font-medium leading-tight">{k.label}</span>
                <span className="text-[10px] leading-tight text-muted-foreground">{k.hint}</span>
              </button>
            ))}
          </div>

          <Field label="Account name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isCard ? 'HDFC Business Credit Card' : 'HDFC Bank – Current'}
            />
          </Field>

          {needsBankFields && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank name">
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="HDFC Bank" />
              </Field>
              <Field label={isCard ? 'Card number' : 'Account number'}>
                <Input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder={isCard ? '•••• 7731' : '50100xxxxxxx'}
                  className="font-mono"
                />
              </Field>
              {!isCard && (
                <Field label="IFSC" className="sm:col-span-2">
                  <Input
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    placeholder="HDFC0000123"
                    className="font-mono"
                  />
                </Field>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={isCard ? 'Amount owed today' : 'Opening balance'}
              hint="Posts against Owner's Capital — this money predates the books"
            >
              <MoneyInput valuePaise={opening} onChangePaise={setOpening} />
            </Field>
            <Field label="As on">
              <Input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-2">
            {kind === 'bank' && (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Make this the primary account</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Used as the default when recording payments
                  </span>
                </span>
                <Switch checked={isPrimary} onCheckedChange={setIsPrimary} />
              </label>
            )}
            {needsBankFields && (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Connect a bank feed</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Pulls transactions daily instead of uploading statements
                  </span>
                </span>
                <Switch checked={feed} onCheckedChange={setFeed} />
              </label>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save account</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
