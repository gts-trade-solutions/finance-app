'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Banking workspace. Zoho keeps banking as a single destination — accounts on
// the page, everything else (import, rules, transfers, cheques, reconcile)
// reached from here rather than from six separate menu entries. This page is
// that hub: balances first, then the work waiting to be done.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link';
import { useMemo } from 'react';
import {
  ArrowLeftRight, ArrowRight, CreditCard, FileClock, FileSpreadsheet, Landmark,
  MoreHorizontal, RefreshCw, ScrollText, Split, Wallet,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { StatTile } from '@/components/shared/stat-tile';
import { useAppStore } from '@/lib/store';
import { cashPosition, totalCash } from '@/lib/selectors';
import { formatINRCompact } from '@/lib/money';

const ICONS = { bank: Landmark, card: CreditCard, cash: Wallet, wallet: Wallet };

/** The tools that used to be separate sidebar entries. */
const TOOLS = [
  { href: '/banking/imports', icon: FileSpreadsheet, label: 'Import Statement', hint: 'Upload a CSV or pull the feed' },
  { href: '/banking/rules', icon: ScrollText, label: 'Bank Rules', hint: 'Auto-categorise repeating lines' },
  { href: '/banking/transfers', icon: ArrowLeftRight, label: 'Transfers', hint: 'Move money between own accounts' },
  { href: '/banking/cheques', icon: FileClock, label: 'Cheques & PDC', hint: 'Cheques in hand and post-dated' },
];

export default function BankingPage() {
  const s = useAppStore();
  const positions = cashPosition(s);
  const unmatchedTotal = s.bankTxns.filter((t) => t.status === 'unmatched').length;

  const recent = useMemo(
    () =>
      [...s.bankTxns]
        .filter((t) => t.status === 'unmatched')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 6),
    [s.bankTxns],
  );

  return (
    <>
      <PageHeader
        title="Banking"
        description="Every account, feed and reconciliation in one place. Balances are computed from the ledger, never stored."
        actions={
          <>
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
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" asChild className="gap-1.5">
              <Link href="/banking/reconcile">
                <Split className="size-4" /> Reconcile
                {unmatchedTotal > 0 && (
                  <span className="ml-0.5 rounded-full bg-white/25 px-1.5 text-[10px] tabular">
                    {unmatchedTotal}
                  </span>
                )}
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Net cash position" value={formatINRCompact(totalCash(s))} icon={Landmark} tone="positive" />
        <StatTile
          label="Lines to reconcile"
          value={String(unmatchedTotal)}
          sub={unmatchedTotal ? 'Waiting to be matched' : 'Everything is matched'}
          icon={Split}
          tone={unmatchedTotal ? 'warning' : 'positive'}
          href="/banking/reconcile"
        />
        <StatTile
          label="Connected feeds"
          value={`${s.bankAccounts.filter((b) => b.feedConnected).length} of ${s.bankAccounts.length}`}
          sub="Syncing daily"
          icon={RefreshCw}
        />
      </div>

      {/* Accounts */}
      <section className="space-y-3">
        <h2 className="micro-label">Accounts</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {s.bankAccounts.map((acct) => {
            const Icon = ICONS[acct.kind];
            const pos = positions.find((p) => p.accountId === acct.id);
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
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {acct.accountLast4 ? `•••• ${acct.accountLast4}` : 'No account number'}
                      {acct.ifsc && ` · ${acct.ifsc}`}
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
                    <Money value={pos?.balance ?? 0} className="mt-1 block text-xl font-semibold" />
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

      {/* Needs attention */}
      {recent.length > 0 && (
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
                {recent.map((t) => {
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

      {/* Tools, surfaced on the page rather than in the sidebar */}
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
    </>
  );
}
