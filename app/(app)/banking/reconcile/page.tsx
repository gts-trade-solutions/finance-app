'use client';

// The reconciliation workspace — the screen accountants live in.
// Two panes: bank lines on the left, suggested matches on the right.
// Keyboard: ↑/↓ move, Enter confirms the top suggestion.

import { useEffect, useMemo, useState } from 'react';
import {
  Check, EyeOff, Link2, Loader2, RefreshCw, Search, Split, Undo2, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { Combobox } from '@/components/ui/combobox';
import { bankAccountOptions } from '@/lib/options';
import { cn } from '@/lib/utils';
import { contactName } from '@/lib/selectors';
import {
  applyBankRules, excludeBankTxn, matchBankTxn, unmatchBankTxn, ruleMatches,
} from '@/lib/services/banking';
import { createExpense } from '@/lib/services/purchases';
import { fetchBankFeed } from '@/lib/mock/simulators';

interface Suggestion {
  kind: 'payment' | 'expense' | 'rule';
  id: string;
  label: string;
  sublabel: string;
  amountPaise: number;
  confidence: number; // 0–1
  accountId?: string;
}

export default function ReconcilePage() {
  const s = useAppStore();
  const [accountId, setAccountId] = useState(s.bankAccounts[0]?.id ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [feedBusy, setFeedBusy] = useState(false);

  const txns = useMemo(
    () =>
      s.bankTxns
        .filter((t) => t.bankAccountId === accountId)
        .filter((t) => !query || t.narration.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [s.bankTxns, accountId, query],
  );

  const unmatched = txns.filter((t) => t.status === 'unmatched');
  const selected = txns.find((t) => t.id === selectedId) ?? unmatched[0] ?? null;

  // Ledger balance vs statement balance — the number that must reach zero
  const account = s.bankAccounts.find((b) => b.id === accountId);
  const ledgerBalance = useMemo(() => {
    if (!account) return 0;
    return s.entries
      .flatMap((e) => e.lines)
      .filter((l) => l.accountId === account.ledgerAccountId)
      .reduce((t, l) => t + l.debit - l.credit, 0);
  }, [s.entries, account]);

  const statementNet = txns
    .filter((t) => t.status !== 'excluded')
    .reduce((t, x) => t + (x.direction === 'in' ? x.amountPaise : -x.amountPaise), 0);

  /** Suggestions for the selected line — exact amount matches rank highest. */
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!selected) return [];
    const out: Suggestion[] = [];

    // Rule hits
    for (const rule of s.bankRules.filter((r) => r.isActive)) {
      if (ruleMatches(rule, selected)) {
        const acc = s.accounts.find((a) => a.id === rule.actionAccountId);
        out.push({
          kind: 'rule',
          id: rule.id,
          label: `Categorise as ${acc?.name}`,
          sublabel: `Rule: ${rule.name}`,
          amountPaise: selected.amountPaise,
          confidence: 0.95,
          accountId: rule.actionAccountId,
        });
      }
    }

    // Existing payments not yet reconciled
    const alreadyMatched = new Set(
      s.bankTxns.filter((t) => t.matchedTo).map((t) => `${t.matchedTo!.type}:${t.matchedTo!.id}`),
    );
    for (const p of s.payments) {
      if (alreadyMatched.has(`payment:${p.id}`)) continue;
      const wantsIn = p.kind === 'received';
      if ((selected.direction === 'in') !== wantsIn) continue;
      const diff = Math.abs(p.amountPaise - selected.amountPaise);
      if (diff > selected.amountPaise * 0.02) continue; // 2% tolerance
      const nameHit = contactName(s, p.contactId)
        .toLowerCase()
        .split(' ')[0];
      const narrationHit = selected.narration.toLowerCase().includes(nameHit);
      out.push({
        kind: 'payment',
        id: p.id,
        label: `${p.number} · ${contactName(s, p.contactId)}`,
        sublabel: `${p.kind === 'received' ? 'Payment received' : 'Payment made'} on ${new Date(p.date).toLocaleDateString('en-IN')}`,
        amountPaise: p.amountPaise,
        confidence: diff === 0 ? (narrationHit ? 0.99 : 0.9) : 0.7,
      });
    }

    // Existing expenses
    for (const e of s.expenses) {
      if (alreadyMatched.has(`expense:${e.id}`)) continue;
      if (selected.direction !== 'out') continue;
      const total = e.tax.taxablePaise + e.tax.cgstPaise + e.tax.sgstPaise + e.tax.igstPaise;
      if (Math.abs(total - selected.amountPaise) > 100) continue;
      out.push({
        kind: 'expense',
        id: e.id,
        label: `${e.number} · ${e.notes}`,
        sublabel: `Expense on ${new Date(e.date).toLocaleDateString('en-IN')}`,
        amountPaise: total,
        confidence: 0.85,
      });
    }

    return out.sort((a, b) => b.confidence - a.confidence);
  }, [selected, s]);

  const confirm = (sug: Suggestion) => {
    if (!selected) return;
    if (sug.kind === 'rule' && sug.accountId) {
      // Categorising creates the expense, then matches to it
      const exp = createExpense({
        branchId: s.activeBranchId,
        date: selected.date,
        accountId: sug.accountId,
        paidThroughId: selected.bankAccountId,
        amountPaise: selected.amountPaise,
        gstRatePct: 0,
        notes: selected.narration,
        receiptAttached: false,
      });
      matchBankTxn(selected.id, { type: 'expense', id: exp.id, label: exp.number });
    } else {
      matchBankTxn(selected.id, {
        type: sug.kind === 'payment' ? 'payment' : 'expense',
        id: sug.id,
        label: sug.label,
      });
    }
    toast.success('Matched', { description: sug.label });
    const next = unmatched.find((t) => t.id !== selected.id);
    setSelectedId(next?.id ?? null);
  };

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const idx = txns.findIndex((t) => t.id === selected?.id);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedId(txns[Math.min(idx + 1, txns.length - 1)]?.id ?? null);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedId(txns[Math.max(idx - 1, 0)]?.id ?? null);
      } else if (e.key === 'Enter' && suggestions[0]) {
        e.preventDefault();
        confirm(suggestions[0]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const runRules = () => {
    const hits = applyBankRules(accountId);
    toast.success(`${hits.length} line(s) matched by rules`);
  };

  const runFeed = async () => {
    setFeedBusy(true);
    const n = await fetchBankFeed(accountId);
    setFeedBusy(false);
    toast.success(`${n} new transaction(s) pulled from the bank feed`);
  };

  return (
    <>
      <PageHeader
        title="Reconcile"
        description="Match what the bank says against what your books say. Use ↑ ↓ to move and Enter to accept the top suggestion."
        actions={
          <>
            <Combobox
              options={bankAccountOptions(s)}
              value={accountId}
              onChange={(v) => { setAccountId(v); setSelectedId(null); }}
              placeholder="Select account"
              searchPlaceholder="Search accounts"
              className="w-56"
            />
            {account?.feedConnected && (
              <Button variant="outline" size="sm" onClick={runFeed} disabled={feedBusy} className="gap-1.5">
                {feedBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Fetch feed
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={runRules} className="gap-1.5">
              <Zap className="size-3.5" /> Run rules
            </Button>
          </>
        }
      />

      {/* The delta that must reach zero */}
      <Card className="flex flex-wrap items-center gap-6 p-4">
        <div>
          <p className="text-xs text-muted-foreground">Statement (net movement)</p>
          <Money value={statementNet} className="text-lg font-semibold" />
        </div>
        <div className="text-muted-foreground">vs</div>
        <div>
          <p className="text-xs text-muted-foreground">Ledger balance</p>
          <Money value={ledgerBalance} className="text-lg font-semibold" />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Lines to reconcile</p>
            <p className="text-lg font-semibold tabular">{unmatched.length}</p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-[11px]',
              unmatched.length === 0
                ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-500/40 text-amber-700 dark:text-amber-300',
            )}
          >
            {unmatched.length === 0 ? 'Fully reconciled' : 'In progress'}
          </Badge>
        </div>
      </Card>

      {txns.length === 0 ? (
        <EmptyState
          icon={Split}
          title="No transactions to reconcile"
          description="Import a bank statement or pull the feed to get started."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Left: bank lines */}
          <Card className="flex flex-col p-0">
            <div className="flex items-center gap-2 border-b p-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter narration…"
                  className="h-8 pl-8"
                />
              </div>
              <Badge variant="secondary" className="text-[10px]">{txns.length} lines</Badge>
            </div>
            <div className="max-h-[560px] overflow-y-auto thin-scroll">
              {txns.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-0',
                    selected?.id === t.id ? 'bg-accent' : 'hover:bg-accent/50',
                    t.status !== 'unmatched' && 'opacity-60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.narration}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      {t.reference && ` · ${t.reference}`}
                    </p>
                    {t.matchedTo && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                        <Link2 className="size-3" /> {t.matchedTo.label}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <Money
                      value={t.direction === 'in' ? t.amountPaise : -t.amountPaise}
                      colored
                      className="text-sm font-medium"
                    />
                    {t.status === 'matched' && (
                      <Badge variant="outline" className="mt-1 gap-0.5 border-emerald-500/40 text-[9px]">
                        <Check className="size-2.5" /> Matched
                      </Badge>
                    )}
                    {t.status === 'excluded' && (
                      <Badge variant="secondary" className="mt-1 text-[9px]">Excluded</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {/* Right: suggestions for the selected line */}
          <Card className="p-4">
            {!selected ? (
              <div className="flex h-full items-center justify-center py-16 text-sm text-muted-foreground">
                All lines on this account are reconciled.
              </div>
            ) : (
              <>
                <div className="mb-4 rounded-lg border bg-muted/40 p-3">
                  <p className="text-sm font-medium">{selected.narration}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{new Date(selected.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                    <Money
                      value={selected.direction === 'in' ? selected.amountPaise : -selected.amountPaise}
                      colored
                      className="font-medium"
                    />
                  </div>
                </div>

                {selected.status !== 'unmatched' ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
                      <p className="text-sm font-medium">
                        {selected.status === 'matched' ? 'Already matched' : 'Excluded from reconciliation'}
                      </p>
                      {selected.matchedTo && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{selected.matchedTo.label}</p>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => { unmatchBankTxn(selected.id); toast.info('Unmatched'); }} className="gap-1.5">
                      <Undo2 className="size-3.5" /> Undo
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Suggested matches
                    </p>
                    {suggestions.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-6 text-center">
                        <p className="text-sm text-muted-foreground">
                          Nothing in your books matches this line.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Record it as an expense, or exclude it if it isn&apos;t a business transaction.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {suggestions.map((sug, idx) => (
                          <div
                            key={`${sug.kind}-${sug.id}`}
                            className={cn(
                              'flex items-center gap-3 rounded-lg border p-3',
                              idx === 0 && 'border-primary/50 bg-primary/5',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{sug.label}</p>
                              <p className="text-xs text-muted-foreground">{sug.sublabel}</p>
                            </div>
                            <div className="text-right">
                              <Money value={sug.amountPaise} className="text-sm" />
                              <p className="text-[10px] text-muted-foreground">
                                {Math.round(sug.confidence * 100)}% match
                              </p>
                            </div>
                            <Button size="sm" onClick={() => confirm(sug)} className="gap-1">
                              <Check className="size-3.5" />
                              {idx === 0 ? 'Match ⏎' : 'Match'}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { excludeBankTxn(selected.id); toast.info('Line excluded'); }}
                        className="gap-1.5"
                      >
                        <EyeOff className="size-3.5" /> Exclude
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
