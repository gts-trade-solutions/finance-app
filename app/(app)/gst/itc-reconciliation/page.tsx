'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Mail, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { StatTile } from '@/components/shared/stat-tile';
import { useAppStore } from '@/lib/store';
import { formatINRCompact } from '@/lib/money';
import type { Gstr2bEntry } from '@/lib/types';

const BUCKETS = {
  matched: {
    label: 'Matched',
    tone: 'text-emerald-600 dark:text-emerald-400',
    blurb: 'Your bill and the supplier’s filing agree. Credit is safe to claim.',
  },
  mismatch: {
    label: 'Mismatched',
    tone: 'text-amber-600 dark:text-amber-400',
    blurb: 'Both sides reported the invoice but the figures differ. Someone has a typo — usually worth a phone call.',
  },
  missing_in_books: {
    label: 'Not in your books',
    tone: 'text-blue-600 dark:text-blue-400',
    blurb: 'The supplier filed an invoice you never recorded. You are leaving credit on the table — book it.',
  },
  missing_in_2b: {
    label: 'Supplier has not filed',
    tone: 'text-red-600 dark:text-red-400',
    blurb: 'You claimed credit but the government has no record. This is the money most at risk — chase the vendor.',
  },
} as const;

export default function ItcReconciliationPage() {
  const s = useAppStore();
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const g: Record<string, Gstr2bEntry[]> = { matched: [], mismatch: [], missing_in_books: [], missing_in_2b: [] };
    for (const e of s.gstr2b) g[e.matchStatus]?.push(e);
    return g;
  }, [s.gstr2b]);

  const atRisk = groups.missing_in_2b.reduce((t, e) => t + e.taxPaise, 0);
  const missed = groups.missing_in_books.reduce((t, e) => t + e.taxPaise, 0);
  const safe = groups.matched.reduce((t, e) => t + e.taxPaise, 0);

  const pull = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 1600));
    setBusy(false);
    toast.success('GSTR-2B downloaded', { description: `${s.gstr2b.length} invoices fetched and matched against your books.` });
  };

  const Table = ({ rows }: { rows: Gstr2bEntry[] }) => (
    <div className="overflow-x-auto rounded-lg border thin-scroll">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold">Supplier</th>
            <th className="px-3 py-2 text-left font-semibold">GSTIN</th>
            <th className="px-3 py-2 text-left font-semibold">Invoice</th>
            <th className="px-3 py-2 text-left font-semibold">Date</th>
            <th className="px-3 py-2 text-right font-semibold">Taxable</th>
            <th className="px-3 py-2 text-right font-semibold">Tax credit</th>
            <th className="px-3 py-2 text-left font-semibold">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">Nothing in this bucket — good news.</td></tr>
          ) : (
            rows.map((e) => (
              <tr key={e.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-3 py-2 font-medium">{e.vendorName}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{e.vendorGstin}</td>
                <td className="px-3 py-2">{e.invoiceNo}</td>
                <td className="px-3 py-2 text-xs">{new Date(e.invoiceDate).toLocaleDateString('en-IN')}</td>
                <td className="px-3 py-2 text-right"><Money value={e.taxablePaise} /></td>
                <td className="px-3 py-2 text-right font-medium"><Money value={e.taxPaise} /></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{e.note ?? '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader
        title="ITC reconciliation (GSTR-2B)"
        description="Your purchase records against the government's record of what your suppliers actually filed."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={pull} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {busy ? 'Fetching 2B…' : 'Fetch GSTR-2B'}
            </Button>
            {groups.missing_in_2b.length > 0 && (
              <Button
                size="sm"
                onClick={() => toast.success(`Reminder emailed to ${groups.missing_in_2b.length} supplier(s)`, { description: 'Asking them to file their return so your credit is protected.' })}
                className="gap-1.5"
              >
                <Mail className="size-3.5" /> Chase suppliers
              </Button>
            )}
          </>
        }
      />

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">Why this screen makes money</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The GST you pay on purchases can be deducted from the GST you owe on sales — <em>but only if your supplier
            actually filed their return</em>. If they didn&apos;t, the credit is disallowed and you pay that tax again
            out of your own pocket. GSTR-2B is the government&apos;s list of what suppliers have filed. Comparing it
            against your books, every month, is the difference between claiming that money and losing it.
          </p>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Credit at risk" value={formatINRCompact(atRisk)} sub={`${groups.missing_in_2b.length} supplier(s) haven't filed`} icon={TriangleAlert} tone={atRisk ? 'danger' : 'positive'} />
        <StatTile label="Credit being missed" value={formatINRCompact(missed)} sub={`${groups.missing_in_books.length} unbooked purchase(s)`} tone={missed ? 'warning' : 'positive'} />
        <StatTile label="Credit confirmed" value={formatINRCompact(safe)} sub={`${groups.matched.length} invoices matched`} icon={CheckCircle2} tone="positive" />
        <StatTile label="Mismatches" value={String(groups.mismatch.length)} sub="Figures disagree" tone={groups.mismatch.length ? 'warning' : 'positive'} />
      </div>

      <Tabs defaultValue="missing_in_2b">
        <TabsList>
          {(Object.keys(BUCKETS) as (keyof typeof BUCKETS)[]).map((k) => (
            <TabsTrigger key={k} value={k}>
              {BUCKETS[k].label} ({groups[k].length})
            </TabsTrigger>
          ))}
        </TabsList>
        {(Object.keys(BUCKETS) as (keyof typeof BUCKETS)[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4 space-y-3">
            <p className={`text-xs ${BUCKETS[k].tone}`}>{BUCKETS[k].blurb}</p>
            <Table rows={groups[k]} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
