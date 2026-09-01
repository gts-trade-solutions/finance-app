'use client';

// Books against GSTR-2B.
//
// Since 2022 input credit is only claimable if the supplier actually filed the
// invoice. What is in your books is irrelevant if it is not in your 2B — so the
// comparison has to run in both directions, and the expensive direction is the
// second one: a bill you hold and have already claimed credit on, that the
// supplier never filed.

import { useState } from 'react';
import { CheckCircle2, Mail, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { StatTile } from '@/components/shared/stat-tile';
import { AsyncPage } from '@/components/shared/async-state';
import { gst, type ItcMatchRow } from '@/lib/api/client';
import { useApi } from '@/lib/api/use-api';
import { formatINRCompact } from '@/lib/money';

const BUCKETS = {
  matched: {
    label: 'Matched',
    tone: 'text-emerald-600 dark:text-emerald-400',
    blurb: 'Your bill and the supplier’s filing agree. Credit is safe to claim.',
  },
  mismatch: {
    label: 'Mismatched',
    tone: 'text-amber-600 dark:text-amber-400',
    blurb:
      'Both sides reported the invoice but the figures differ. Someone has a typo — usually worth a phone call.',
  },
  missing_in_books: {
    label: 'Not in your books',
    tone: 'text-blue-600 dark:text-blue-400',
    blurb: 'The supplier filed an invoice you never recorded. You are leaving credit on the table — book it.',
  },
  missing_in_portal: {
    label: 'Supplier has not filed',
    tone: 'text-red-600 dark:text-red-400',
    blurb:
      'You claimed credit but the government has no record. This is the money most at risk — chase the vendor before the annual return.',
  },
} as const;

type Bucket = keyof typeof BUCKETS;

const thisMonth = () => new Date().toISOString().slice(0, 7);
const short = (d: string) => new Date(d).toLocaleDateString('en-IN');

function MatchTable({ rows }: { rows: ItcMatchRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        Nothing in this bucket for the period.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border thin-scroll">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold">Supplier</th>
            <th className="px-3 py-2 text-left font-semibold">GSTIN</th>
            <th className="px-3 py-2 text-left font-semibold">Their invoice</th>
            <th className="px-3 py-2 text-left font-semibold">Date</th>
            <th className="px-3 py-2 text-left font-semibold">Our bill</th>
            <th className="px-3 py-2 text-right font-semibold">Portal</th>
            <th className="px-3 py-2 text-right font-semibold">Books</th>
            <th className="px-3 py-2 text-right font-semibold">Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.vendorGstin}-${r.invoiceNo}-${i}`} className="border-b last:border-0 hover:bg-accent/40">
              <td className="px-3 py-2 font-medium">{r.vendorName ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-[10px]">{r.vendorGstin}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.invoiceNo}</td>
              <td className="px-3 py-2 text-xs">{short(r.invoiceDate)}</td>
              <td className="px-3 py-2 text-xs">{r.billNo ?? '—'}</td>
              <td className="px-3 py-2 text-right"><Money value={r.portalTaxPaise} showZero={false} /></td>
              <td className="px-3 py-2 text-right"><Money value={r.booksTaxPaise} showZero={false} /></td>
              <td className="px-3 py-2 text-right">
                <Money value={r.differencePaise} colored showZero={false} className="font-medium" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ItcReconciliationPage() {
  const [period, setPeriod] = useState(thisMonth());
  const state = useApi(() => gst.itc(period), [period]);

  return (
    <>
      <PageHeader
        title="ITC reconciliation"
        description="Your purchase records against what the government says your suppliers actually filed."
        actions={
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-8 w-40"
          />
        }
      />

      <AsyncPage state={state}>
        {(d) => {
          const byBucket = (b: Bucket) => d.rows.filter((r) => r.matchStatus === b);
          const missed = byBucket('missing_in_books').reduce((t, r) => t + r.portalTaxPaise, 0);

          return (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile
                  label="Credit at risk"
                  value={formatINRCompact(d.summary.atRiskPaise)}
                  sub="Claimed in your books, not supported by the portal"
                  icon={ShieldAlert}
                  tone={d.summary.atRiskPaise > 0 ? 'danger' : 'positive'}
                />
                <StatTile
                  label="Credit not claimed"
                  value={formatINRCompact(missed)}
                  sub="Filed by a supplier, missing from your books"
                  icon={TriangleAlert}
                  tone={missed > 0 ? 'warning' : 'positive'}
                />
                <StatTile
                  label="Matched cleanly"
                  value={`${d.summary.matched} of ${d.summary.total}`}
                  sub="Both sides agree to the paisa"
                  icon={CheckCircle2}
                  tone="positive"
                />
              </div>

              {d.summary.atRiskPaise > 0 && (
                <Card className="flex flex-wrap items-start gap-3 border-destructive/40 bg-destructive/5 p-4">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">
                      <Money value={d.summary.atRiskPaise} /> of input credit is not backed by a supplier filing.
                    </span>{' '}
                    Since 2022 credit is only claimable if it appears in your GSTR-2B. If these are not filed
                    before the annual return, the credit has to be reversed with interest — so this is a phone call
                    worth making now rather than in September.
                  </p>
                  <Button variant="outline" size="sm" className="gap-1.5" disabled>
                    <Mail className="size-3.5" /> Chase suppliers
                  </Button>
                </Card>
              )}

              <Tabs defaultValue="missing_in_portal">
                <TabsList>
                  {(Object.keys(BUCKETS) as Bucket[]).map((b) => (
                    <TabsTrigger key={b} value={b}>
                      {BUCKETS[b].label} ({byBucket(b).length})
                    </TabsTrigger>
                  ))}
                </TabsList>
                {(Object.keys(BUCKETS) as Bucket[]).map((b) => (
                  <TabsContent key={b} value={b} className="mt-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <Badge variant="outline" className={`shrink-0 text-[10px] ${BUCKETS[b].tone}`}>
                        {BUCKETS[b].label}
                      </Badge>
                      <p className="text-xs text-muted-foreground">{BUCKETS[b].blurb}</p>
                    </div>
                    <MatchTable rows={byBucket(b)} />
                  </TabsContent>
                ))}
              </Tabs>

              <Card className="flex items-start gap-3 p-4">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Matching is on the supplier&apos;s own invoice number and GSTIN, because that is what the portal
                  keys on — our internal bill number means nothing to them. A supplier who types their own invoice
                  number differently in their GSTR-1 will show here as unmatched even when the money is right.
                </p>
              </Card>
            </>
          );
        }}
      </AsyncPage>
    </>
  );
}
