'use client';

import Link from 'next/link';
import { AlertTriangle, Clock, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { StatTile } from '@/components/shared/stat-tile';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import { billBalance, msmeTracker } from '@/lib/selectors';
import { formatINRCompact } from '@/lib/money';

export default function MsmeTrackerPage() {
  const s = useAppStore();
  const rows = msmeTracker(s);

  const breached = rows.filter((r) => r.risk === 'breached');
  const critical = rows.filter((r) => r.risk === 'critical');
  const atRiskValue = [...breached, ...critical].reduce((t, r) => t + billBalance(r.bill), 0);

  return (
    <>
      <PageHeader
        title="MSME 45-day tracker"
        description="Section 43B(h) of the Income Tax Act — a rule most software ignores."
      />

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">Why this screen exists</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            If you buy from a registered micro or small enterprise and don&apos;t pay them within 45 days, the law
            says you <strong>cannot claim that expense</strong> when calculating your income tax for the year — so you
            pay tax on money you&apos;ve already spent. The deduction only comes back in the year you actually pay.
            Missing this quietly inflates your tax bill, which is why we count the days for you.
          </p>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Past 45 days"
          value={String(breached.length)}
          sub="Expense already disallowed"
          icon={AlertTriangle}
          tone={breached.length ? 'danger' : 'positive'}
        />
        <StatTile
          label="Approaching limit"
          value={String(critical.length)}
          sub="Within 7 days of the deadline"
          icon={Clock}
          tone={critical.length ? 'warning' : 'positive'}
        />
        <StatTile
          label="Value at risk"
          value={formatINRCompact(atRiskValue)}
          sub="Unpaid MSME bills in the danger zone"
          tone={atRiskValue > 0 ? 'warning' : 'positive'}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No unpaid MSME bills"
          description="Every bill from a registered micro or small enterprise has been settled. Nothing at risk."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const pct = Math.min(100, (r.age / 45) * 100);
            return (
              <Card key={r.bill.id} className="p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/purchases/bills/${r.bill.id}`} className="font-medium hover:underline">
                        {r.vendorName}
                      </Link>
                      <Badge variant="outline" className="text-[10px]">{r.bill.internalNo}</Badge>
                      {r.risk === 'breached' && (
                        <Badge variant="outline" className="border-red-500/40 text-[10px] text-red-600 dark:text-red-400">
                          Deduction disallowed
                        </Badge>
                      )}
                      {r.risk === 'critical' && (
                        <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-300">
                          {r.daysLeft} day{r.daysLeft === 1 ? '' : 's'} left
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Billed {new Date(r.bill.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · {r.age} days ago
                    </p>
                    <div className="mt-2.5 max-w-md">
                      <Progress
                        value={pct}
                        className={
                          r.risk === 'breached'
                            ? '[&>div]:bg-red-500'
                            : r.risk === 'critical'
                              ? '[&>div]:bg-amber-500'
                              : '[&>div]:bg-emerald-500'
                        }
                      />
                      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>Day {r.age}</span>
                        <span>45-day limit</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <Money value={billBalance(r.bill)} className="text-lg font-semibold" />
                    <div className="mt-2">
                      <Button size="sm" asChild>
                        <Link href={`/purchases/payments/new?bill=${r.bill.id}`}>Pay now</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
