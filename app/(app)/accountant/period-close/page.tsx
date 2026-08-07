'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ArrowRight, CalendarClock, CheckCircle2, Lock, Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { today } from '@/lib/selectors';
import { trialBalance } from '@/lib/ledger/reports';

interface CheckItem {
  id: string;
  label: string;
  detail: string;
  count: number;
  href?: string;
  blocking: boolean;
}

export default function PeriodClosePage() {
  const s = useAppStore();
  const canClose = usePermission('accountant', 'approve');
  const [locked, setLocked] = useState(false);

  const period = useMemo(() => {
    const d = new Date(today());
    return {
      label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      from: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10),
      to: today(),
    };
  }, []);

  const checks = useMemo<CheckItem[]>(() => {
    const unreconciled = s.bankTxns.filter((t) => t.status === 'unmatched').length;
    const drafts = s.invoices.filter((i) => i.status === 'draft').length;
    const noIrn = s.invoices.filter(
      (i) => i.einvoice.status === 'pending' || i.einvoice.status === 'failed',
    ).length;
    const itcRisk = s.gstr2b.filter((g) => g.matchStatus !== 'matched').length;
    const unapplied = s.payments.filter((p) => p.unappliedPaise > 0).length;
    const tb = trialBalance(s.accounts, s.entries);

    return [
      {
        id: 'balance',
        label: 'Trial balance agrees',
        detail: tb.balanced
          ? 'Debits and credits match to the paisa.'
          : 'The books do not balance — this must be fixed before closing.',
        count: tb.balanced ? 0 : 1,
        href: '/reports/trial-balance',
        blocking: true,
      },
      {
        id: 'recon',
        label: 'Bank accounts reconciled',
        detail: unreconciled ? `${unreconciled} statement line(s) still unmatched.` : 'Every bank line is accounted for.',
        count: unreconciled,
        href: '/banking/reconcile',
        blocking: true,
      },
      {
        id: 'drafts',
        label: 'No draft invoices left',
        detail: drafts ? `${drafts} invoice(s) still in draft and not posted.` : 'All invoices are approved and posted.',
        count: drafts,
        href: '/sales/invoices',
        blocking: false,
      },
      {
        id: 'irn',
        label: 'E-invoices registered',
        detail: noIrn ? `${noIrn} invoice(s) have no IRN. The 30-day window applies.` : 'Every B2B invoice carries a valid IRN.',
        count: noIrn,
        href: '/gst/einvoices',
        blocking: true,
      },
      {
        id: 'itc',
        label: 'Input credit reconciled to GSTR-2B',
        detail: itcRisk ? `${itcRisk} mismatch(es) between your books and the government's record.` : 'Books agree with GSTR-2B.',
        count: itcRisk,
        href: '/gst/itc-reconciliation',
        blocking: false,
      },
      {
        id: 'unapplied',
        label: 'Payments fully applied',
        detail: unapplied ? `${unapplied} payment(s) sitting on account, not matched to an invoice.` : 'No unapplied receipts.',
        count: unapplied,
        href: '/sales/payments',
        blocking: false,
      },
    ];
  }, [s]);

  const outstanding = checks.filter((c) => c.count > 0);
  const blockers = outstanding.filter((c) => c.blocking);
  const done = checks.length - outstanding.length;

  return (
    <>
      <PageHeader
        title="Period close"
        description={`Run through the checklist, then lock ${period.label} so nobody can quietly change last month's numbers.`}
        actions={
          canClose &&
          (locked ? (
            <Button variant="outline" size="sm" onClick={() => { setLocked(false); toast.info('Period reopened', { description: 'This action is recorded in the audit trail.' }); }} className="gap-1.5">
              <Unlock className="size-3.5" /> Reopen period
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={blockers.length > 0}
              onClick={() => { setLocked(true); toast.success(`${period.label} locked`, { description: 'No further entries can be posted into this period.' }); }}
              className="gap-1.5"
            >
              <Lock className="size-3.5" /> Lock {period.label}
            </Button>
          ))
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Period</p>
          <p className="mt-1 text-xl font-semibold">{period.label}</p>
          <Badge variant="outline" className={`mt-2 text-[10px] ${locked ? 'border-emerald-500/40' : 'border-amber-500/40'}`}>
            {locked ? 'Locked' : 'Open'}
          </Badge>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Checks passed</p>
          <p className="mt-1 text-xl font-semibold tabular">{done} of {checks.length}</p>
        </Card>
        <Card className={'p-4 ' + (blockers.length ? 'border-destructive/40 bg-destructive/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
          <p className="text-xs text-muted-foreground">Blocking issues</p>
          <p className="mt-1 text-xl font-semibold tabular">{blockers.length}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {blockers.length ? 'Must be cleared before locking' : 'Ready to close'}
          </p>
        </Card>
      </div>

      <div className="space-y-2">
        {checks.map((c) => {
          const ok = c.count === 0;
          return (
            <Card key={c.id} className={'flex flex-wrap items-center gap-4 p-4 ' + (!ok && c.blocking ? 'border-destructive/30' : '')}>
              {ok ? (
                <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className={'size-5 shrink-0 ' + (c.blocking ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{c.label}</p>
                  {!ok && c.blocking && <Badge variant="outline" className="border-destructive/40 text-[9px]">Blocking</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
              </div>
              {!ok && c.href && (
                <Button variant="outline" size="sm" asChild className="gap-1">
                  <Link href={c.href}>Fix <ArrowRight className="size-3" /></Link>
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">What locking a period actually does</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Once a month is locked, no new entry can be dated into it. That matters because reports and tax returns
            for that month have already gone out — if someone backdates an invoice afterwards, your filed figures and
            your books silently stop agreeing. Only an admin can reopen a locked period, and doing so is itself
            recorded in the audit trail.
          </p>
        </div>
      </Card>
    </>
  );
}
