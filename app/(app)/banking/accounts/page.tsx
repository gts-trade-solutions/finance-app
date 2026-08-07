'use client';

import Link from 'next/link';
import { CreditCard, Landmark, Split, Wallet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { StatTile } from '@/components/shared/stat-tile';
import { useAppStore } from '@/lib/store';
import { cashPosition, totalCash } from '@/lib/selectors';
import { formatINRCompact } from '@/lib/money';

const ICONS = { bank: Landmark, card: CreditCard, cash: Wallet, wallet: Wallet };

export default function BankAccountsPage() {
  const s = useAppStore();
  const positions = cashPosition(s);

  return (
    <>
      <PageHeader
        title="Bank & cash accounts"
        description="Balances are computed live from the ledger — never a stored figure that can drift."
        actions={
          <Button size="sm" asChild className="gap-1.5">
            <Link href="/banking/reconcile"><Split className="size-4" /> Reconcile</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Net cash position" value={formatINRCompact(totalCash(s))} icon={Landmark} tone="positive" />
        <StatTile
          label="Unreconciled lines"
          value={String(s.bankTxns.filter((t) => t.status === 'unmatched').length)}
          icon={Split}
          tone={s.bankTxns.some((t) => t.status === 'unmatched') ? 'warning' : 'positive'}
          href="/banking/reconcile"
        />
        <StatTile
          label="Connected feeds"
          value={`${s.bankAccounts.filter((b) => b.feedConnected).length} of ${s.bankAccounts.length}`}
          icon={Wallet}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {s.bankAccounts.map((acct) => {
          const Icon = ICONS[acct.kind];
          const pos = positions.find((p) => p.accountId === acct.id);
          const unmatched = s.bankTxns.filter((t) => t.bankAccountId === acct.id && t.status === 'unmatched').length;
          const ledgerAccount = s.accounts.find((a) => a.id === acct.ledgerAccountId);
          return (
            <Card key={acct.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2.5">
                    <Icon className="size-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium">{acct.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {acct.accountLast4 ? `•••• ${acct.accountLast4}` : 'No account number'}
                      {acct.ifsc && ` · ${acct.ifsc}`}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Ledger: {ledgerAccount?.code} {ledgerAccount?.name}
                    </p>
                  </div>
                </div>
                {acct.feedConnected && (
                  <Badge variant="outline" className="shrink-0 border-emerald-500/40 text-[10px]">
                    Feed live
                  </Badge>
                )}
              </div>

              <div className="mt-4 flex items-end justify-between border-t pt-4">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {acct.kind === 'card' ? 'Outstanding' : 'Balance'}
                  </p>
                  <Money value={pos?.balance ?? 0} className="text-2xl font-semibold" />
                </div>
                {unmatched > 0 && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/banking/reconcile">{unmatched} to reconcile</Link>
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
