'use client';

import { useMemo } from 'react';
import { Download, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { StatTile } from '@/components/shared/stat-tile';
import { useAppStore } from '@/lib/store';
import { contactName, vendors } from '@/lib/selectors';
import { TDS_SECTIONS } from '@/lib/tax/tds';
import { formatINRCompact, toRupees } from '@/lib/money';
import { downloadCsv } from '@/components/shared/report-shell';

export default function TdsTcsPage() {
  const s = useAppStore();

  // TDS we withheld from vendors (a liability owed to the government)
  const withheld = useMemo(() => {
    const map = new Map<string, { section: string; gross: number; tds: number; bills: number }>();
    for (const b of s.bills) {
      if (b.status === 'void' || b.tdsPaise === 0) continue;
      const key = `${b.vendorId}|${b.tdsSection}`;
      const cur = map.get(key) ?? { section: b.tdsSection ?? '', gross: 0, tds: 0, bills: 0 };
      cur.gross += b.subtotalPaise;
      cur.tds += b.tdsPaise;
      cur.bills += 1;
      map.set(key, cur);
    }
    return [...map.entries()].map(([key, v]) => ({ vendorId: key.split('|')[0], ...v }));
  }, [s.bills]);

  // TDS our customers deducted from us (an asset we reclaim at filing)
  const deductedFromUs = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of s.payments) {
      if (p.kind !== 'received' || p.tdsPaise === 0) continue;
      map.set(p.contactId, (map.get(p.contactId) ?? 0) + p.tdsPaise);
    }
    return [...map.entries()];
  }, [s.payments]);

  // Threshold progress per vendor — shows TDS kicking in automatically
  const thresholds = useMemo(
    () =>
      vendors(s)
        .filter((v) => v.tdsSection)
        .map((v) => {
          const section = TDS_SECTIONS.find((t) => t.code === v.tdsSection)!;
          const ytd = s.bills
            .filter((b) => b.vendorId === v.id && b.status !== 'void')
            .reduce((t, b) => t + b.subtotalPaise, 0);
          return {
            vendor: v,
            section,
            ytd,
            pct: Math.min(100, (ytd / section.thresholdAnnualPaise) * 100),
            crossed: ytd >= section.thresholdAnnualPaise,
          };
        })
        .sort((a, b) => b.pct - a.pct),
    [s],
  );

  const totalWithheld = withheld.reduce((t, w) => t + w.tds, 0);
  const totalReceivable = deductedFromUs.reduce((t, [, v]) => t + v, 0);

  return (
    <>
      <PageHeader
        title="TDS & TCS"
        description="Tax withheld at source — both the tax you hold back from vendors and the tax your customers hold back from you."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              downloadCsv('form-26Q-data.csv', [
                ['Vendor', 'PAN', 'Section', 'Gross paid', 'TDS deducted', 'Bills'],
                ...withheld.map((w) => {
                  const v = s.contacts.find((c) => c.id === w.vendorId);
                  return [contactName(s, w.vendorId), v?.pan ?? 'NOT AVAILABLE', w.section, toRupees(w.gross), toRupees(w.tds), w.bills];
                }),
              ]);
              toast.success('Form 26Q data exported', { description: 'Hand this to your CA for the quarterly TDS return.' });
            }}
          >
            <Download className="size-3.5" /> Export 26Q data
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="TDS payable" value={formatINRCompact(totalWithheld)} sub="Withheld from vendors, owed to government" icon={Receipt} tone="warning" />
        <StatTile label="TDS receivable" value={formatINRCompact(totalReceivable)} sub="Deducted by customers, reclaimable" tone="positive" />
        <StatTile label="Vendors tracked" value={String(thresholds.length)} sub={`${thresholds.filter((t) => t.crossed).length} past threshold`} />
      </div>

      <Tabs defaultValue="thresholds">
        <TabsList>
          <TabsTrigger value="thresholds">Threshold tracking</TabsTrigger>
          <TabsTrigger value="payable">TDS payable ({withheld.length})</TabsTrigger>
          <TabsTrigger value="receivable">TDS receivable ({deductedFromUs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="thresholds" className="mt-4 space-y-3">
          <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
            <Receipt className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="font-medium">Why thresholds matter</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                You only have to withhold tax once your payments to a vendor cross a limit for the year — for
                contractors that&apos;s ₹1,00,000 annually, for professional fees ₹30,000. Below the line you pay in
                full; above it you must hold back tax and remit it yourself. The app counts every vendor&apos;s running
                total and starts deducting the moment the line is crossed, which is exactly the thing businesses forget
                and get penalised for.
              </p>
            </div>
          </Card>

          <div className="space-y-2">
            {thresholds.map((t) => (
              <Card key={t.vendor.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{t.vendor.displayName}</p>
                    <Badge variant="secondary" className="text-[10px]">{t.section.code}</Badge>
                    <span className="text-xs text-muted-foreground">{t.section.description}</span>
                    {!t.vendor.pan && (
                      <Badge variant="outline" className="border-red-500/40 text-[9px]">No PAN → 20%</Badge>
                    )}
                    {t.crossed && (
                      <Badge variant="outline" className="border-emerald-500/40 text-[9px]">Deducting at {t.vendor.pan ? t.section.ratePctWithPan : t.section.ratePctWithoutPan}%</Badge>
                    )}
                  </div>
                  <div className="mt-2 max-w-md">
                    <Progress value={t.pct} className={t.crossed ? '[&>div]:bg-emerald-500' : '[&>div]:bg-amber-500'} />
                    <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                      <span>Billed this year: ₹{(t.ytd / 100).toLocaleString('en-IN')}</span>
                      <span>Threshold: ₹{(t.section.thresholdAnnualPaise / 100).toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="payable" className="mt-4">
          <div className="overflow-x-auto rounded-lg border thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Vendor</th>
                  <th className="px-3 py-2 text-left font-semibold">PAN</th>
                  <th className="px-3 py-2 text-left font-semibold">Section</th>
                  <th className="px-3 py-2 text-right font-semibold">Bills</th>
                  <th className="px-3 py-2 text-right font-semibold">Gross billed</th>
                  <th className="px-3 py-2 text-right font-semibold">TDS withheld</th>
                </tr>
              </thead>
              <tbody>
                {withheld.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">No TDS has been withheld yet.</td></tr>
                ) : (
                  withheld.map((w, i) => {
                    const v = s.contacts.find((c) => c.id === w.vendorId);
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{contactName(s, w.vendorId)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{v?.pan ?? <span className="text-destructive">Not available</span>}</td>
                        <td className="px-3 py-2"><Badge variant="secondary" className="text-[10px]">{w.section}</Badge></td>
                        <td className="px-3 py-2 text-right tabular">{w.bills}</td>
                        <td className="px-3 py-2 text-right"><Money value={w.gross} /></td>
                        <td className="px-3 py-2 text-right font-medium"><Money value={w.tds} /></td>
                      </tr>
                    );
                  })
                )}
                {withheld.length > 0 && (
                  <tr className="border-t-2 bg-muted/40 font-semibold">
                    <td className="px-3 py-2.5" colSpan={5}>Total payable to government</td>
                    <td className="px-3 py-2.5 text-right"><Money value={totalWithheld} /></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="receivable" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            When a customer withholds tax from your invoice, they pay it to the government in your name. You reclaim it
            when filing your income tax return — so it sits as an asset, not a loss. Check these against your Form 26AS.
          </p>
          <div className="overflow-x-auto rounded-lg border thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Customer</th>
                  <th className="px-3 py-2 text-right font-semibold">TDS deducted</th>
                </tr>
              </thead>
              <tbody>
                {deductedFromUs.length === 0 ? (
                  <tr><td colSpan={2} className="px-3 py-10 text-center text-sm text-muted-foreground">No customer has withheld TDS yet.</td></tr>
                ) : (
                  deductedFromUs.map(([id, amt]) => (
                    <tr key={id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{contactName(s, id)}</td>
                      <td className="px-3 py-2 text-right font-medium"><Money value={amt} /></td>
                    </tr>
                  ))
                )}
                {deductedFromUs.length > 0 && (
                  <tr className="border-t-2 bg-muted/40 font-semibold">
                    <td className="px-3 py-2.5">Total reclaimable</td>
                    <td className="px-3 py-2.5 text-right"><Money value={totalReceivable} /></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
