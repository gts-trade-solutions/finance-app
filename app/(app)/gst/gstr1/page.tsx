'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { useAppStore } from '@/lib/store';
import { contactName, today } from '@/lib/selectors';
import { totalTaxPaise } from '@/lib/tax/gst';
import { toRupees } from '@/lib/money';
import type { Invoice } from '@/lib/types';

/**
 * GSTR-1 is the monthly return of everything you SOLD. The portal wants it
 * split into specific sections depending on who the buyer was.
 */
const SECTION_HELP: Record<string, string> = {
  B2B: 'Sales to GST-registered businesses. They need these to claim their input credit.',
  B2CL: 'Sales above ₹2.5 lakh to unregistered buyers in another state.',
  B2CS: 'All other sales to unregistered buyers — reported as a summary, not invoice by invoice.',
  EXP: 'Exports and supplies to SEZ units — zero-rated.',
  CDNR: 'Credit and debit notes issued against registered buyers.',
};

export default function Gstr1Page() {
  const s = useAppStore();
  const [month, setMonth] = useState(today().slice(0, 7));

  const data = useMemo(() => {
    const inRange = (d: string) => d.startsWith(month);
    const invoices = s.invoices.filter((i) => i.status !== 'void' && i.status !== 'draft' && inRange(i.date));
    const creditNotes = s.creditNotes.filter((c) => c.status !== 'void' && inRange(c.date));

    const b2b: Invoice[] = [];
    const b2cl: Invoice[] = [];
    const b2cs: Invoice[] = [];
    const exp: Invoice[] = [];

    for (const inv of invoices) {
      const cust = s.contacts.find((c) => c.id === inv.customerId);
      if (inv.supplyType === 'export_lut' || inv.supplyType === 'export_with_tax' || inv.supplyType === 'sez') {
        exp.push(inv);
      } else if (cust?.gstin) {
        b2b.push(inv);
      } else if (inv.supplyType === 'inter' && inv.totalPaise > 2_50_000_00) {
        b2cl.push(inv);
      } else {
        b2cs.push(inv);
      }
    }

    // HSN summary — the portal requires goods rolled up by HSN code
    const hsnMap = new Map<string, { qty: number; taxable: number; tax: number; uqc: string }>();
    for (const inv of invoices) {
      for (const l of inv.lines) {
        const key = l.hsnSac || 'UNCLASSIFIED';
        const cur = hsnMap.get(key) ?? { qty: 0, taxable: 0, tax: 0, uqc: l.uqc };
        cur.qty += l.qty;
        cur.taxable += l.tax.taxablePaise;
        cur.tax += totalTaxPaise(l.tax);
        hsnMap.set(key, cur);
      }
    }

    // Validation checks the portal would otherwise reject on
    const errors: { level: 'error' | 'warning'; message: string }[] = [];
    const missingHsn = invoices.flatMap((i) => i.lines).filter((l) => !l.hsnSac).length;
    if (missingHsn) errors.push({ level: 'error', message: `${missingHsn} line(s) have no HSN/SAC code — the portal will reject the return.` });
    const noIrn = b2b.filter((i) => i.einvoice.status !== 'submitted').length;
    if (noIrn) errors.push({ level: 'warning', message: `${noIrn} B2B invoice(s) have no IRN. Register them before filing.` });
    const noGstin = b2b.filter((i) => !s.contacts.find((c) => c.id === i.customerId)?.gstin).length;
    if (noGstin) errors.push({ level: 'error', message: `${noGstin} B2B invoice(s) have a missing customer GSTIN.` });

    const totals = invoices.reduce(
      (acc, i) => ({
        taxable: acc.taxable + i.tax.taxablePaise,
        cgst: acc.cgst + i.tax.cgstPaise,
        sgst: acc.sgst + i.tax.sgstPaise,
        igst: acc.igst + i.tax.igstPaise,
      }),
      { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
    );

    return { b2b, b2cl, b2cs, exp, creditNotes, hsn: [...hsnMap.entries()], errors, totals, count: invoices.length };
  }, [s, month]);

  const exportJson = () => {
    const payload = {
      gstin: s.branches.find((b) => b.id === s.activeBranchId)?.gstin,
      fp: month.replace('-', '').slice(4) + month.slice(0, 4),
      b2b: data.b2b.map((i) => ({
        ctin: s.contacts.find((c) => c.id === i.customerId)?.gstin,
        inv: [{
          inum: i.number,
          idt: i.date,
          val: toRupees(i.totalPaise),
          pos: i.placeOfSupply,
          itms: i.lines.map((l, n) => ({
            num: n + 1,
            itm_det: {
              rt: l.gstRatePct,
              txval: toRupees(l.tax.taxablePaise),
              camt: toRupees(l.tax.cgstPaise),
              samt: toRupees(l.tax.sgstPaise),
              iamt: toRupees(l.tax.igstPaise),
            },
          })),
        }],
      })),
      hsn: { data: data.hsn.map(([code, v], n) => ({ num: n + 1, hsn_sc: code, uqc: v.uqc, qty: v.qty, txval: toRupees(v.taxable) })) },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1-${month}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('GSTR-1 JSON downloaded', { description: 'Upload this file directly to the GST portal.' });
  };

  const InvoiceTable = ({ rows, showGstin = true }: { rows: Invoice[]; showGstin?: boolean }) => (
    <div className="overflow-x-auto rounded-lg border thin-scroll">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold">Invoice</th>
            <th className="px-3 py-2 text-left font-semibold">Date</th>
            <th className="px-3 py-2 text-left font-semibold">Customer</th>
            {showGstin && <th className="px-3 py-2 text-left font-semibold">GSTIN</th>}
            <th className="px-3 py-2 text-left font-semibold">POS</th>
            <th className="px-3 py-2 text-right font-semibold">Taxable</th>
            <th className="px-3 py-2 text-right font-semibold">CGST</th>
            <th className="px-3 py-2 text-right font-semibold">SGST</th>
            <th className="px-3 py-2 text-right font-semibold">IGST</th>
            <th className="px-3 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">No entries in this section.</td></tr>
          ) : (
            rows.map((i) => (
              <tr key={i.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-3 py-2 font-medium">{i.number}</td>
                <td className="px-3 py-2 text-xs">{new Date(i.date).toLocaleDateString('en-IN')}</td>
                <td className="px-3 py-2">{contactName(s, i.customerId)}</td>
                {showGstin && (
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {s.contacts.find((c) => c.id === i.customerId)?.gstin ?? '—'}
                  </td>
                )}
                <td className="px-3 py-2 text-xs">{i.placeOfSupply}</td>
                <td className="px-3 py-2 text-right"><Money value={i.tax.taxablePaise} /></td>
                <td className="px-3 py-2 text-right"><Money value={i.tax.cgstPaise} showZero={false} /></td>
                <td className="px-3 py-2 text-right"><Money value={i.tax.sgstPaise} showZero={false} /></td>
                <td className="px-3 py-2 text-right"><Money value={i.tax.igstPaise} showZero={false} /></td>
                <td className="px-3 py-2 text-right font-medium"><Money value={i.totalPaise} /></td>
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
        title="GSTR-1 — outward supplies"
        description="Everything you sold this month, arranged the way the GST portal wants it."
        actions={
          <>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-8 w-40" />
            <Button size="sm" onClick={exportJson} className="gap-1.5">
              <Download className="size-3.5" /> Export portal JSON
            </Button>
          </>
        }
      />

      {data.errors.length > 0 && (
        <Card className="space-y-2 border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-medium">Before you file</p>
          {data.errors.map((e, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertCircle className={'mt-0.5 size-3.5 shrink-0 ' + (e.level === 'error' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')} />
              <p className="text-xs text-muted-foreground">{e.message}</p>
            </div>
          ))}
        </Card>
      )}
      {data.errors.length === 0 && data.count > 0 && (
        <Card className="flex items-center gap-3 border-emerald-500/40 bg-emerald-500/5 p-4">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm">Every invoice passes validation. This return is ready to upload.</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total taxable value</p>
          <Money value={data.totals.taxable} className="mt-1 block text-xl font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">CGST</p>
          <Money value={data.totals.cgst} className="mt-1 block text-xl font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">SGST</p>
          <Money value={data.totals.sgst} className="mt-1 block text-xl font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">IGST</p>
          <Money value={data.totals.igst} className="mt-1 block text-xl font-semibold" />
        </Card>
      </div>

      <Tabs defaultValue="b2b">
        <TabsList>
          <TabsTrigger value="b2b">B2B ({data.b2b.length})</TabsTrigger>
          <TabsTrigger value="b2cl">B2CL ({data.b2cl.length})</TabsTrigger>
          <TabsTrigger value="b2cs">B2CS ({data.b2cs.length})</TabsTrigger>
          <TabsTrigger value="exp">Exports ({data.exp.length})</TabsTrigger>
          <TabsTrigger value="cdnr">Credit notes ({data.creditNotes.length})</TabsTrigger>
          <TabsTrigger value="hsn">HSN summary ({data.hsn.length})</TabsTrigger>
        </TabsList>

        {(['b2b', 'b2cl', 'b2cs', 'exp'] as const).map((key) => (
          <TabsContent key={key} value={key} className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">{SECTION_HELP[key.toUpperCase()]}</p>
            <InvoiceTable rows={data[key]} showGstin={key === 'b2b'} />
          </TabsContent>
        ))}

        <TabsContent value="cdnr" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">{SECTION_HELP.CDNR}</p>
          <div className="overflow-x-auto rounded-lg border thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Note #</th>
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-left font-semibold">Customer</th>
                  <th className="px-3 py-2 text-left font-semibold">Reason</th>
                  <th className="px-3 py-2 text-right font-semibold">Taxable</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.creditNotes.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">No credit notes this month.</td></tr>
                ) : (
                  data.creditNotes.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{c.number}</td>
                      <td className="px-3 py-2 text-xs">{new Date(c.date).toLocaleDateString('en-IN')}</td>
                      <td className="px-3 py-2">{contactName(s, c.customerId)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.reason}</td>
                      <td className="px-3 py-2 text-right"><Money value={c.tax.taxablePaise} /></td>
                      <td className="px-3 py-2 text-right font-medium"><Money value={c.totalPaise} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="hsn" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Goods rolled up by HSN code — the portal requires this summary so it can cross-check what industries are selling.
          </p>
          <div className="overflow-x-auto rounded-lg border thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">HSN / SAC</th>
                  <th className="px-3 py-2 text-left font-semibold">UQC</th>
                  <th className="px-3 py-2 text-right font-semibold">Quantity</th>
                  <th className="px-3 py-2 text-right font-semibold">Taxable value</th>
                  <th className="px-3 py-2 text-right font-semibold">Tax</th>
                </tr>
              </thead>
              <tbody>
                {data.hsn.map(([code, v]) => (
                  <tr key={code} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono font-medium">
                      {code}
                      {code === 'UNCLASSIFIED' && (
                        <Badge variant="outline" className="ml-2 border-destructive/40 text-[9px]">Missing</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{v.uqc}</td>
                    <td className="px-3 py-2 text-right tabular">{v.qty}</td>
                    <td className="px-3 py-2 text-right"><Money value={v.taxable} /></td>
                    <td className="px-3 py-2 text-right"><Money value={v.tax} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
