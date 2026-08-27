'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Banking workspace, following Zoho's Banking Overview: balances grouped by
// account type, the uncategorised count as the call to action, a balance chart
// over a chosen window, then the accounts themselves.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowRight, Banknote, ChevronDown, CreditCard, FileClock, FileSpreadsheet,
  Landmark, MoreHorizontal, Plus, ScrollText, Split, TrendingUp,
  Wallet, ArrowLeftRight,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { AddBankAccountDialog } from '@/components/forms/add-bank-account';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { cashPosition, today } from '@/lib/selectors';
import { axisProps, axisRupee, rupeeFormatter, tooltipStyle } from '@/components/charts/chart-bits';
import { cn } from '@/lib/utils';
import type { BankAccount } from '@/lib/types';

const ICONS: Record<BankAccount['kind'], typeof Landmark> = {
  bank: Landmark,
  card: CreditCard,
  cash: Wallet,
  wallet: Wallet,
  clearing: Banknote,
};

/** The four balance tiles Zoho shows, each summing one kind of account. */
const TILES: { kind: BankAccount['kind'][]; label: string; icon: typeof Landmark }[] = [
  { kind: ['bank'], label: 'Bank Balance', icon: Landmark },
  { kind: ['card'], label: 'Card Balance', icon: CreditCard },
  { kind: ['cash', 'wallet'], label: 'Cash In Hand', icon: Wallet },
  { kind: ['clearing'], label: 'Payment Clearing', icon: Banknote },
];

const RANGES = [
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'This financial year' },
];

const TOOLS = [
  { href: '/banking/imports', icon: FileSpreadsheet, label: 'Import Statement', hint: 'Upload a CSV or pull the feed' },
  { href: '/banking/rules', icon: ScrollText, label: 'Bank Rules', hint: 'Auto-categorise repeating lines' },
  { href: '/banking/transfers', icon: ArrowLeftRight, label: 'Transfers', hint: 'Move money between own accounts' },
  { href: '/banking/cheques', icon: FileClock, label: 'Cheques & PDC', hint: 'Cheques in hand and post-dated' },
];

export default function BankingPage() {
  const s = useAppStore();
  const canCreate = usePermission('banking', 'create');
  const [addOpen, setAddOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState('all');
  const [days, setDays] = useState('30');
  const [showChart, setShowChart] = useState(true);

  const positions = cashPosition(s);
  const balanceOf = (id: string) => positions.find((p) => p.accountId === id)?.balance ?? 0;

  const visibleAccounts = useMemo(
    () => (accountFilter === 'all' ? s.bankAccounts : s.bankAccounts.filter((b) => b.id === accountFilter)),
    [s.bankAccounts, accountFilter],
  );

  const uncategorised = s.bankTxns.filter(
    (t) => t.status === 'unmatched' && (accountFilter === 'all' || t.bankAccountId === accountFilter),
  );

  /** Daily closing balance per account kind across the chosen window. */
  const series = useMemo(() => {
    const n = Number(days);
    const end = new Date(today());
    const ids = new Map(s.bankAccounts.map((b) => [b.ledgerAccountId, b.kind]));

    // Opening position before the window, then walk forward day by day.
    const running: Record<string, number> = { bank: 0, card: 0, cash: 0, clearing: 0 };
    const start = new Date(end);
    start.setDate(start.getDate() - n);
    const startIso = start.toISOString().slice(0, 10);

    for (const e of s.entries) {
      if (e.date >= startIso) continue;
      for (const l of e.lines) {
        const kind = ids.get(l.accountId);
        if (!kind) continue;
        const key = kind === 'wallet' ? 'cash' : kind;
        running[key] = (running[key] ?? 0) + l.debit - l.credit;
      }
    }

    const byDate = new Map<string, typeof s.entries>();
    for (const e of s.entries) {
      if (e.date < startIso || e.date > today()) continue;
      byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    }

    const out: { date: string; bank: number; card: number; cash: number; clearing: number }[] = [];
    // A point every few days keeps a 90-day chart readable.
    const step = n > 90 ? 7 : n > 45 ? 3 : 1;
    for (let i = 0; i <= n; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      for (const e of byDate.get(iso) ?? []) {
        for (const l of e.lines) {
          const kind = ids.get(l.accountId);
          if (!kind) continue;
          const key = kind === 'wallet' ? 'cash' : kind;
          running[key] = (running[key] ?? 0) + l.debit - l.credit;
        }
      }
      if (i % step === 0 || i === n) {
        out.push({
          date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
          bank: running.bank / 100,
          card: running.card / 100,
          cash: running.cash / 100,
          clearing: running.clearing / 100,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.entries, s.bankAccounts, days]);

  return (
    <>
      <PageHeader
        title="Banking Overview"
        description="Every account, feed and reconciliation in one place. Balances are computed from the ledger, never stored."
        actions={
          <>
            <Button variant="outline" size="sm" asChild className="gap-1.5">
              <Link href="/banking/imports">
                <FileSpreadsheet className="size-4" /> Import Statement
              </Link>
            </Button>
            {canCreate && (
              <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
                <Plus className="size-4" /> Add Bank or Credit Card
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Banking tools"
                className="grid size-9 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Banking tools</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {TOOLS.map((t) => (
                  <DropdownMenuItem key={t.href} asChild>
                    <Link href={t.href}>
                      <t.icon className="mr-2 size-4" />
                      <span className="flex-1">{t.label}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/banking/reconcile">
                    <Split className="mr-2 size-4" />
                    <span className="flex-1">Reconcile</span>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <Card className="p-5">
        {/* Scope + window */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Combobox
            options={[
              { value: 'all', label: 'All Accounts' },
              ...s.bankAccounts.map((b) => ({
                value: b.id,
                label: b.name,
                sublabel: b.bankName ?? b.kind,
              })),
            ]}
            value={accountFilter}
            onChange={setAccountFilter}
            showAvatar={false}
            searchPlaceholder="Search accounts"
            className="w-56"
          />
          <Combobox
            options={RANGES}
            value={days}
            onChange={setDays}
            showAvatar={false}
            searchPlaceholder="Range"
            className="w-44"
          />
        </div>

        {/* Balance tiles by account type */}
        <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-5 border-y py-5">
          {TILES.map((tile) => {
            const accts = s.bankAccounts.filter((b) => tile.kind.includes(b.kind));
            if (accts.length === 0) return null;
            const total = accts.reduce((t, a) => t + balanceOf(a.id), 0);
            return (
              <div key={tile.label} className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-md bg-accent">
                  <tile.icon className="size-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="micro-label">{tile.label}</p>
                  <Money value={total} className="mt-0.5 block text-lg font-semibold" />
                </div>
              </div>
            );
          })}

          <Link href="/banking/reconcile" className="ml-auto flex items-center gap-3 group">
            <span
              className={cn(
                'grid h-10 min-w-10 place-items-center rounded-md px-2 text-base font-semibold tabular',
                uncategorised.length
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-success/10 text-success',
              )}
            >
              {uncategorised.length}
            </span>
            <span>
              <span className="block text-sm font-medium">Uncategorised Transactions</span>
              <span className="flex items-center gap-1 text-xs text-primary group-hover:underline">
                Categorise now <ArrowRight className="size-3" />
              </span>
            </span>
          </Link>
        </div>

        {/* Balance chart */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowChart((v) => !v)}
            className="flex items-center gap-1.5 text-[13px] font-medium text-primary"
          >
            <TrendingUp className="size-3.5" />
            {showChart ? 'Hide Chart' : 'Show Chart'}
            <ChevronDown className={cn('size-3.5 transition-transform', showChart && 'rotate-180')} />
          </button>

          {showChart && (
            <ResponsiveContainer width="100%" height={230} className="mt-3">
              <AreaChart data={series} margin={{ left: -8, right: 8, top: 6 }}>
                <defs>
                  <linearGradient id="gBank" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" {...axisProps} minTickGap={24} />
                <YAxis tickFormatter={axisRupee} {...axisProps} width={64} />
                <Tooltip formatter={rupeeFormatter} contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="bank" name="Bank Balance" stroke="var(--chart-1)" fill="url(#gBank)" strokeWidth={2} />
                <Area type="monotone" dataKey="cash" name="Cash In Hand" stroke="var(--chart-3)" fill="none" strokeWidth={1.5} />
                <Area type="monotone" dataKey="card" name="Card Balance" stroke="var(--chart-5)" fill="none" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Accounts */}
      <section className="space-y-3">
        <h2 className="micro-label">Accounts</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleAccounts.map((acct) => {
            const Icon = ICONS[acct.kind];
            const unmatched = s.bankTxns.filter(
              (t) => t.bankAccountId === acct.id && t.status === 'unmatched',
            ).length;
            const ledgerAccount = s.accounts.find((a) => a.id === acct.ledgerAccountId);
            return (
              <Card key={acct.id} className="accent-bar p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <p className="truncate font-medium">{acct.name}</p>
                      {acct.isPrimary && (
                        <Badge variant="secondary" className="shrink-0 text-[9px]">Primary</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {acct.bankName ? `${acct.bankName} · ` : ''}
                      {acct.accountLast4 ? `•••• ${acct.accountLast4}` : 'No account number'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {ledgerAccount?.code} {ledgerAccount?.name}
                    </p>
                  </div>
                  {acct.feedConnected && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">Feed live</Badge>
                  )}
                </div>

                <div className="mt-4 flex items-end justify-between border-t pt-4">
                  <div>
                    <p className="micro-label">{acct.kind === 'card' ? 'Outstanding' : 'Balance'}</p>
                    <Money value={balanceOf(acct.id)} className="mt-1 block text-xl font-semibold" />
                  </div>
                  {unmatched > 0 && (
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/banking/reconcile">{unmatched} to match</Link>
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Uncategorised queue */}
      {uncategorised.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="micro-label">Uncategorised transactions</h2>
            <Link href="/banking/reconcile" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Reconcile all <ArrowRight className="size-3" />
            </Link>
          </div>
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <tbody>
                {uncategorised.slice(0, 6).map((t) => {
                  const acct = s.bankAccounts.find((b) => b.id === t.bankAccountId);
                  return (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular">
                        {new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </td>
                      <td className="px-4 py-3">
                        <p className="truncate font-medium">{t.narration}</p>
                        <p className="text-xs text-muted-foreground">{acct?.name}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Money
                          value={t.direction === 'in' ? t.amountPaise : -t.amountPaise}
                          colored
                          className="font-medium"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {/* Tools */}
      <section className="space-y-3">
        <h2 className="micro-label">Tools</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {TOOLS.map((t) => (
            <Link key={t.href} href={t.href}>
              <Card className="h-full p-4 transition-colors hover:border-primary/40">
                <t.icon className="size-4 text-muted-foreground" />
                <p className="mt-2.5 text-sm font-medium">{t.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t.hint}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <AddBankAccountDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
