'use client';

// The MSME 45-day tracker — section 43B(h), a rule most software ignores.
//
// The clock runs from the bill date, not the due date. Agreeing 60-day terms
// with an MSME supplier does not extend the 45 days; it just means your own
// terms guarantee you will breach them.

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
import { AsyncPage } from '@/components/shared/async-state';
import { msmeTracker, type MsmeTrackerResponse } from '@/lib/api/client';
import { useApi } from '@/lib/api/use-api';
import { formatINRCompact } from '@/lib/money';

export default function MsmeTrackerPage() {
  const state = useApi<MsmeTrackerResponse>(() => msmeTracker.list(), []);

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
            The 45 days run from the bill date, whatever payment terms you agreed. Missing this quietly inflates your
            tax bill, which is why we count the days for you.
          </p>
        </div>
      </Card>

      <AsyncPage state={state}>
        {(d) => (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Past 45 days"
                value={String(d.summary.breached)}
                sub="Expense already disallowed"
                icon={AlertTriangle}
                tone={d.summary.breached ? 'danger' : 'positive'}
              />
              <StatTile
                label="Approaching limit"
                value={String(d.summary.critical)}
                sub="Within 7 days of the deadline"
                icon={Clock}
                tone={d.summary.critical ? 'warning' : 'positive'}
              />
              <StatTile
                label="Value at risk"
                value={formatINRCompact(d.summary.atRiskPaise)}
                sub="Unpaid MSME bills in the danger zone"
                tone={d.summary.atRiskPaise > 0 ? 'warning' : 'positive'}
              />
            </div>

            {d.items.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No unpaid MSME bills"
                description="Every bill from a registered micro or small enterprise has been settled. Nothing at risk."
              />
            ) : (
              <div className="space-y-3">
                {d.items.map((r) => {
                  const pct = Math.min(100, (r.age / 45) * 100);
                  return (
                    <Card key={r.billId} className="p-4">
                      <div className="flex flex-wrap items-start gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/purchases/bills/${r.billId}`} className="font-medium hover:underline">
                              {r.vendorName}
                            </Link>
                            <Badge variant="outline" className="text-[10px]">{r.internalNo}</Badge>
                            {r.risk === 'breached' && (
                              <Badge
                                variant="outline"
                                className="border-red-500/40 text-[10px] text-red-600 dark:text-red-400"
                              >
                                Deduction disallowed
                              </Badge>
                            )}
                            {r.risk === 'critical' && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-300"
                              >
                                {r.daysLeft} day{r.daysLeft === 1 ? '' : 's'} left
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Billed{' '}
                            {new Date(r.date).toLocaleDateString('en-IN', {
                              day: 'numeric', month: 'long', year: 'numeric',
                            })}{' '}
                            · {r.age} days ago
                            {r.udyamNo ? ` · ${r.udyamNo}` : ''}
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
                          <Money value={r.balancePaise} className="text-lg font-semibold" />
                          <div className="mt-2">
                            <Button size="sm" asChild>
                              <Link href={`/purchases/payments/new?bill=${r.billId}`}>Pay now</Link>
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
        )}
      </AsyncPage>
    </>
  );
}
