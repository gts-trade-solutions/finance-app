'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Recurring Journals — Zoho's automation for entries that repeat unchanged:
// depreciation, prepaid rent amortisation, accrued salaries. The point is that
// nobody has to remember them, and they post with the same wording every month
// so the ledger reads consistently.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { CalendarClock, Play, Plus, Repeat, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { EmptyState } from '@/components/shared/empty-state';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { today } from '@/lib/selectors';
import { accountOptions } from '@/lib/options';
import { createManualJournal } from '@/lib/services/journal';
import { UnbalancedEntryError } from '@/lib/ledger/posting';
import { cn } from '@/lib/utils';

interface RecurringJournal {
  id: string;
  name: string;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  nextRun: string;
  debitAccountId: string;
  creditAccountId: string;
  amountPaise: number;
  memo: string;
  active: boolean;
  lastPosted?: string;
}

const FREQUENCY = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

/** Seeded profiles — the three entries almost every business repeats. */
const SEED: Omit<RecurringJournal, 'debitAccountId' | 'creditAccountId'>[] = [
  { id: 'rj1', name: 'Monthly depreciation — furniture & equipment', frequency: 'monthly', nextRun: '2026-09-01', amountPaise: 12_500_00, memo: 'Depreciation for the month', active: true },
  { id: 'rj2', name: 'Prepaid insurance amortisation', frequency: 'monthly', nextRun: '2026-09-01', amountPaise: 4_200_00, memo: 'Insurance expense for the month', active: true },
  { id: 'rj3', name: 'Accrued audit fee', frequency: 'quarterly', nextRun: '2026-10-01', amountPaise: 25_000_00, memo: 'Audit fee accrual', active: false },
];

export default function RecurringJournalsPage() {
  const s = useAppStore();
  const canCreate = usePermission('accountant', 'create');
  const accounts = useMemo(() => accountOptions(s), [s]);

  const [profiles, setProfiles] = useState<RecurringJournal[]>(() =>
    SEED.map((p) => ({
      ...p,
      debitAccountId: s.accounts.find((a) => a.type === 'expense')?.id ?? '',
      creditAccountId: s.accounts.find((a) => a.type === 'asset' && a.code === '1600')?.id
        ?? s.accounts.find((a) => a.type === 'asset')?.id ?? '',
    })),
  );

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: '', frequency: 'monthly', nextRun: today(),
    debitAccountId: '', creditAccountId: '', amount: 0, memo: '',
  });

  const save = () => {
    if (!f.name.trim() || !f.debitAccountId || !f.creditAccountId || f.amount <= 0) {
      toast.error('Fill in a name, both accounts and an amount.');
      return;
    }
    if (f.debitAccountId === f.creditAccountId) {
      toast.error('Debit and credit must be different accounts.');
      return;
    }
    setProfiles((p) => [
      ...p,
      {
        id: `rj${Date.now()}`,
        name: f.name,
        frequency: f.frequency as RecurringJournal['frequency'],
        nextRun: f.nextRun,
        debitAccountId: f.debitAccountId,
        creditAccountId: f.creditAccountId,
        amountPaise: f.amount,
        memo: f.memo || f.name,
        active: true,
      },
    ]);
    toast.success('Recurring journal created', {
      description: 'It will post automatically on each run date.',
    });
    setOpen(false);
    setF({ name: '', frequency: 'monthly', nextRun: today(), debitAccountId: '', creditAccountId: '', amount: 0, memo: '' });
  };

  /** Post one occurrence now, and roll the next run date forward. */
  const runNow = (p: RecurringJournal) => {
    try {
      createManualJournal({
        date: today(),
        memo: p.memo,
        lines: [
          { accountId: p.debitAccountId, debit: p.amountPaise, credit: 0, description: p.name },
          { accountId: p.creditAccountId, debit: 0, credit: p.amountPaise, description: p.name },
        ],
      });
      const next = new Date(p.nextRun);
      next.setMonth(next.getMonth() + (p.frequency === 'monthly' ? 1 : p.frequency === 'quarterly' ? 3 : 12));
      setProfiles((ps) =>
        ps.map((x) =>
          x.id === p.id ? { ...x, lastPosted: today(), nextRun: next.toISOString().slice(0, 10) } : x,
        ),
      );
      toast.success('Journal posted', { description: `${p.name} — next run ${next.toLocaleDateString('en-IN')}` });
    } catch (e) {
      toast.error(
        e instanceof UnbalancedEntryError ? 'The entry did not balance and was not posted' : (e as Error).message,
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Recurring Journals"
        description="Entries that repeat unchanged — depreciation, amortisation, accruals. Set once, and they post on schedule with identical wording every period."
        actions={
          canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New Recurring Journal</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>New recurring journal</DialogTitle>
                  <DialogDescription>
                    A two-sided entry that repeats. Debits and credits must be equal, as with any journal.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Field label="Profile name" required>
                    <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Monthly depreciation — vehicles" />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Frequency" required>
                      <Combobox options={FREQUENCY} value={f.frequency} onChange={(v) => setF({ ...f, frequency: v })} showAvatar={false} />
                    </Field>
                    <Field label="Next run" required>
                      <Input type="date" value={f.nextRun} onChange={(e) => setF({ ...f, nextRun: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Debit account" required hint="The account that increases">
                    <Combobox options={accounts} value={f.debitAccountId} onChange={(v) => setF({ ...f, debitAccountId: v })} placeholder="Select account" showAvatar={false} searchPlaceholder="Search accounts" />
                  </Field>
                  <Field label="Credit account" required hint="The account that decreases">
                    <Combobox options={accounts} value={f.creditAccountId} onChange={(v) => setF({ ...f, creditAccountId: v })} placeholder="Select account" showAvatar={false} searchPlaceholder="Search accounts" />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Amount" required>
                      <MoneyInput valuePaise={f.amount} onChangePaise={(p) => setF({ ...f, amount: p })} />
                    </Field>
                    <Field label="Narration">
                      <Input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="Depreciation for the month" />
                    </Field>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save}>Create profile</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      {profiles.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No recurring journals"
          description="Set one up for anything you post identically every month."
        />
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => {
            const debit = s.accounts.find((a) => a.id === p.debitAccountId);
            const credit = s.accounts.find((a) => a.id === p.creditAccountId);
            return (
              <Card key={p.id} className={cn('p-4', !p.active && 'opacity-60')}>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{p.name}</p>
                      <Badge variant="secondary" className="text-[10px] capitalize">{p.frequency}</Badge>
                      {!p.active && <Badge variant="outline" className="text-[10px]">Paused</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Dr <span className="text-foreground">{debit?.name ?? '—'}</span>
                      {'  ·  '}
                      Cr <span className="text-foreground">{credit?.name ?? '—'}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarClock className="size-3" />
                      Next run {new Date(p.nextRun).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                      {p.lastPosted && ` · last posted ${new Date(p.lastPosted).toLocaleDateString('en-IN')}`}
                    </p>
                  </div>

                  <Money value={p.amountPaise} className="w-32 text-right font-medium" />

                  <div className="flex items-center gap-2">
                    {canCreate && (
                      <Button variant="outline" size="sm" onClick={() => runNow(p)} className="gap-1.5">
                        <Play className="size-3.5" /> Post now
                      </Button>
                    )}
                    <Switch
                      checked={p.active}
                      onCheckedChange={(v) => {
                        setProfiles((ps) => ps.map((x) => (x.id === p.id ? { ...x, active: v } : x)));
                        toast.info(v ? 'Profile resumed' : 'Profile paused');
                      }}
                    />
                    {canCreate && (
                      <button
                        type="button"
                        aria-label="Delete profile"
                        onClick={() => {
                          setProfiles((ps) => ps.filter((x) => x.id !== p.id));
                          toast.info('Profile deleted', { description: 'Entries it already posted stay in the books.' });
                        }}
                        className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <Repeat className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Deleting a profile stops future postings only. Entries it has already made stay in the ledger, because
          the books never lose a posted transaction — correcting one means posting a reversal, not erasing history.
        </p>
      </Card>
    </>
  );
}
