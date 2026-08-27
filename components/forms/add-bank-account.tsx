'use client';

// ─────────────────────────────────────────────────────────────────────────────
// "Add Bank or Credit Card", following Zoho's two-step shape:
//
//   1. Choose  — connect an automatic feed, or add the account manually.
//   2. Either  — pick a bank and grant consent (simulated), or fill the form.
//
// Presenting the form immediately was wrong: most people want the feed, and
// the manual form is the fallback for banks the provider does not cover.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import {
  ArrowLeft, Banknote, Check, CreditCard, FilePlus2, Landmark, Loader2, Search,
  Sparkles, Wallet,
} from 'lucide-react';
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

/** Banks the (simulated) aggregator covers. Real list comes from the provider. */
const SUPPORTED_BANKS = [
  { name: 'HDFC Bank', ifscPrefix: 'HDFC' },
  { name: 'ICICI Bank', ifscPrefix: 'ICIC' },
  { name: 'State Bank of India', ifscPrefix: 'SBIN' },
  { name: 'Axis Bank', ifscPrefix: 'UTIB' },
  { name: 'Kotak Mahindra Bank', ifscPrefix: 'KKBK' },
  { name: 'IndusInd Bank', ifscPrefix: 'INDB' },
  { name: 'Yes Bank', ifscPrefix: 'YESB' },
  { name: 'Punjab National Bank', ifscPrefix: 'PUNB' },
  { name: 'Bank of Baroda', ifscPrefix: 'BARB' },
  { name: 'Canara Bank', ifscPrefix: 'CNRB' },
  { name: 'Union Bank of India', ifscPrefix: 'UBIN' },
  { name: 'IDFC FIRST Bank', ifscPrefix: 'IDFB' },
  { name: 'Federal Bank', ifscPrefix: 'FDRL' },
  { name: 'RBL Bank', ifscPrefix: 'RATN' },
  { name: 'Indian Bank', ifscPrefix: 'IDIB' },
];

const KINDS: { value: BankAccount['kind']; label: string; icon: typeof Landmark; hint: string }[] = [
  { value: 'bank', label: 'Bank', icon: Landmark, hint: 'Current or savings' },
  { value: 'card', label: 'Credit Card', icon: CreditCard, hint: 'Money you owe' },
  { value: 'cash', label: 'Cash', icon: Wallet, hint: 'Petty cash or till' },
  { value: 'clearing', label: 'Clearing', icon: Banknote, hint: 'Not yet deposited' },
];

type Step = 'choose' | 'connect' | 'manual';

export function AddBankAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [step, setStep] = useState<Step>('choose');
  const [query, setQuery] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);

  const [kind, setKind] = useState<BankAccount['kind']>('bank');
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [opening, setOpening] = useState(0);
  const [openingDate, setOpeningDate] = useState(today());
  const [isPrimary, setIsPrimary] = useState(false);

  const isCard = kind === 'card';
  const needsBankFields = kind === 'bank' || kind === 'card';

  const banks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? SUPPORTED_BANKS.filter((b) => b.name.toLowerCase().includes(q)) : SUPPORTED_BANKS;
  }, [query]);

  const close = () => {
    onOpenChange(false);
    // Reset after the close animation so the dialog doesn't visibly snap back.
    setTimeout(() => {
      setStep('choose'); setQuery(''); setConnecting(null);
      setKind('bank'); setName(''); setBankName(''); setAccountNumber('');
      setIfsc(''); setOpening(0); setIsPrimary(false);
    }, 200);
  };

  const connect = async (bank: (typeof SUPPORTED_BANKS)[number]) => {
    setConnecting(bank.name);
    // Stands in for the provider's consent screen.
    await new Promise((r) => setTimeout(r, 1600));
    const acct = createBankAccount({
      kind: 'bank',
      name: `${bank.name} – Current`,
      bankName: bank.name,
      accountNumber: `XXXXXXXX${Math.floor(1000 + Math.random() * 9000)}`,
      ifsc: `${bank.ifscPrefix}0000123`,
      feedConnected: true,
    });
    setConnecting(null);
    toast.success(`${acct.name} connected`, {
      description: 'Transactions will sync daily. A matching ledger account was created.',
    });
    close();
  };

  const saveManual = () => {
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
    });
    toast.success(`${acct.name} added`, {
      description: opening
        ? 'A ledger account was created and the opening balance posted against capital.'
        : 'A matching ledger account was created so this account can be posted to.',
    });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className={cn(step === 'choose' ? 'max-w-2xl' : 'max-w-lg')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step !== 'choose' && (
              <button
                type="button"
                onClick={() => setStep('choose')}
                aria-label="Back"
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            {step === 'manual' ? 'Add bank account manually' : 'Connect your bank accounts'}
          </DialogTitle>
          <DialogDescription>
            {step === 'manual'
              ? 'Creates the account and its matching ledger account together.'
              : 'Fetch transactions automatically through a bank feed, or add the account manually.'}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: choose ─────────────────────────────────────────── */}
        {step === 'choose' && (
          <div className="space-y-4">
            <div className="rounded-md border">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Sparkles className="size-4 shrink-0 text-primary" />
                <p className="text-sm font-medium">Automatic bank feeds — supported banks</p>
              </div>
              <div className="p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your bank"
                    className="pl-8"
                  />
                </div>

                <div className="thin-scroll mt-3 max-h-56 overflow-y-auto rounded-md border">
                  {banks.length === 0 ? (
                    <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                      No supported bank matches “{query}”. Add it manually below.
                    </p>
                  ) : (
                    banks.map((b) => (
                      <button
                        key={b.name}
                        type="button"
                        disabled={!!connecting}
                        onClick={() => connect(b)}
                        className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-accent disabled:opacity-60"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded bg-accent">
                          <Landmark className="size-3.5 text-muted-foreground" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{b.name}</span>
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            {b.ifscPrefix}0000•••
                          </span>
                        </span>
                        {connecting === b.name ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                        ) : (
                          <span className="shrink-0 text-xs text-primary">Connect</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Account information is fetched under your consent and can be revoked at any time.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-md border p-4">
              <FilePlus2 className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Add bank accounts manually</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Your bank isn&apos;t supported, or you want a cash, card or clearing account?
                  Enter the details yourself and import statements.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setStep('manual')}>
                Add Manually
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: manual form ────────────────────────────────────── */}
        {step === 'manual' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border p-2.5 text-left transition-colors',
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
              <div className="grid gap-3 sm:grid-cols-2">
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

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={isCard ? 'Amount owed today' : 'Opening balance'}
                hint="Posts against Owner's Capital"
              >
                <MoneyInput valuePaise={opening} onChangePaise={setOpening} />
              </Field>
              <Field label="As on">
                <Input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
              </Field>
            </div>

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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          {step === 'manual' && (
            <Button onClick={saveManual} className="gap-1.5">
              <Check className="size-4" /> Save account
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
