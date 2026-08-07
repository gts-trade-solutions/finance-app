'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Info, Wallet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { useAppStore } from '@/lib/store';
import { today } from '@/lib/selectors';
import type { Paise } from '@/lib/types';

/**
 * GSTR-3B is the monthly summary + payment return. The interesting part is the
 * set-off: input credit must be used in a legally prescribed order before any
 * cash is paid. IGST credit goes first, and only then CGST/SGST against their own heads.
 */
function computeSetOff(output: { cgst: Paise; sgst: Paise; igst: Paise }, input: { cgst: Paise; sgst: Paise; igst: Paise }) {
  let igstCredit = input.igst;
  let cgstCredit = input.cgst;
  let sgstCredit = input.sgst;

  const steps: { label: string; amount: Paise }[] = [];

  // 1. IGST credit clears IGST liability first
  const igstVsIgst = Math.min(igstCredit, output.igst);
  const igstDue = output.igst - igstVsIgst;
  igstCredit -= igstVsIgst;
  if (igstVsIgst) steps.push({ label: 'IGST credit → IGST liability', amount: igstVsIgst });

  // 2. Remaining IGST credit spills to CGST, then SGST
  const igstVsCgst = Math.min(igstCredit, output.cgst);
  let cgstDue = output.cgst - igstVsCgst;
  igstCredit -= igstVsCgst;
  if (igstVsCgst) steps.push({ label: 'IGST credit → CGST liability', amount: igstVsCgst });

  const igstVsSgst = Math.min(igstCredit, output.sgst);
  let sgstDue = output.sgst - igstVsSgst;
  igstCredit -= igstVsSgst;
  if (igstVsSgst) steps.push({ label: 'IGST credit → SGST liability', amount: igstVsSgst });

  // 3. CGST credit against CGST, SGST credit against SGST — never cross
  const cgstVsCgst = Math.min(cgstCredit, cgstDue);
  cgstDue -= cgstVsCgst;
  cgstCredit -= cgstVsCgst;
  if (cgstVsCgst) steps.push({ label: 'CGST credit → CGST liability', amount: cgstVsCgst });

  const sgstVsSgst = Math.min(sgstCredit, sgstDue);
  sgstDue -= sgstVsSgst;
  sgstCredit -= sgstVsSgst;
  if (sgstVsSgst) steps.push({ label: 'SGST credit → SGST liability', amount: sgstVsSgst });

  return {
    steps,
    cashPayable: { cgst: cgstDue, sgst: sgstDue, igst: igstDue },
    creditCarried: { cgst: cgstCredit, sgst: sgstCredit, igst: igstCredit },
    totalCash: cgstDue + sgstDue + igstDue,
  };
}

export default function Gstr3bPage() {
  const s = useAppStore();
  const [month, setMonth] = useState(today().slice(0, 7));

  const data = useMemo(() => {
    const inMonth = (d: string) => d.startsWith(month);

    const invoices = s.invoices.filter((i) => i.status !== 'void' && i.status !== 'draft' && inMonth(i.date));
    const creditNotes = s.creditNotes.filter((c) => c.status !== 'void' && inMonth(c.date));
    const bills = s.bills.filter((b) => b.status !== 'void' && inMonth(b.date));
    const expenses = s.expenses.filter((e) => e.status !== 'void' && inMonth(e.date));

    const output = {
      taxable: invoices.reduce((t, i) => t + i.tax.taxablePaise, 0) - creditNotes.reduce((t, c) => t + c.tax.taxablePaise, 0),
      cgst: invoices.reduce((t, i) => t + i.tax.cgstPaise, 0) - creditNotes.reduce((t, c) => t + c.tax.cgstPaise, 0),
      sgst: invoices.reduce((t, i) => t + i.tax.sgstPaise, 0) - creditNotes.reduce((t, c) => t + c.tax.sgstPaise, 0),
      igst: invoices.reduce((t, i) => t + i.tax.igstPaise, 0) - creditNotes.reduce((t, c) => t + c.tax.igstPaise, 0),
    };

    const eligibleBills = bills.filter((b) => !b.isRcm);
    const input = {
      cgst: eligibleBills.reduce((t, b) => t + b.tax.cgstPaise, 0) + expenses.reduce((t, e) => t + e.tax.cgstPaise, 0),
      sgst: eligibleBills.reduce((t, b) => t + b.tax.sgstPaise, 0) + expenses.reduce((t, e) => t + e.tax.sgstPaise, 0),
      igst: eligibleBills.reduce((t, b) => t + b.tax.igstPaise, 0) + expenses.reduce((t, e) => t + e.tax.igstPaise, 0),
    };

    const rcmBills = bills.filter((b) => b.isRcm);
    const rcm = {
      cgst: rcmBills.reduce((t, b) => t + b.tax.cgstPaise, 0),
      sgst: rcmBills.reduce((t, b) => t + b.tax.sgstPaise, 0),
      igst: rcmBills.reduce((t, b) => t + b.tax.igstPaise, 0),
    };

    return { output, input, rcm, setOff: computeSetOff(output, input), invoiceCount: invoices.length, billCount: bills.length };
  }, [s, month]);

  const Row = ({ label, hint, cgst, sgst, igst, emphasis }: {
    label: string; hint?: string; cgst: Paise; sgst: Paise; igst: Paise; emphasis?: boolean;
  }) => (
    <tr className={'border-b last:border-0 ' + (emphasis ? 'bg-muted/40 font-semibold' : '')}>
      <td className="px-4 py-2.5">
        {label}
        {hint && <p className="mt-0.5 text-xs font-normal text-muted-foreground">{hint}</p>}
      </td>
      <td className="px-4 py-2.5 text-right"><Money value={cgst} showZero={false} /></td>
      <td className="px-4 py-2.5 text-right"><Money value={sgst} showZero={false} /></td>
      <td className="px-4 py-2.5 text-right"><Money value={igst} showZero={false} /></td>
      <td className="px-4 py-2.5 text-right"><Money value={cgst + sgst + igst} /></td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title="GSTR-3B — monthly summary"
        description="What you owe the government this month, after using up the credit you've already paid on purchases."
        actions={<Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-8 w-40" />}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Tax collected on sales</p>
          <Money value={data.output.cgst + data.output.sgst + data.output.igst} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-0.5 text-xs text-muted-foreground">{data.invoiceCount} invoices</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Credit available on purchases</p>
          <Money value={data.input.cgst + data.input.sgst + data.input.igst} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-0.5 text-xs text-muted-foreground">{data.billCount} bills</p>
        </Card>
        <Card className={'p-4 ' + (data.setOff.totalCash > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
          <p className="text-xs text-muted-foreground">Cash payable</p>
          <Money value={data.setOff.totalCash} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.setOff.totalCash > 0 ? 'Due by the 20th of next month' : 'Fully covered by input credit'}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 text-left font-semibold">Particulars</th>
                <th className="px-4 py-2.5 text-right font-semibold">CGST</th>
                <th className="px-4 py-2.5 text-right font-semibold">SGST</th>
                <th className="px-4 py-2.5 text-right font-semibold">IGST</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-muted/30">
                <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  3.1 — Outward supplies (what you collected)
                </td>
              </tr>
              <Row label="Taxable outward supplies" hint="GST charged on your sales this month" {...data.output} />
              {(data.rcm.cgst || data.rcm.sgst || data.rcm.igst) > 0 && (
                <Row label="Inward supplies liable to reverse charge" hint="Tax you owe directly on purchases from unregistered suppliers" {...data.rcm} />
              )}

              <tr className="border-b bg-muted/30">
                <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  4 — Eligible input tax credit (what you already paid)
                </td>
              </tr>
              <Row label="Credit on purchases and expenses" hint="GST your suppliers charged you, claimable back" {...data.input} />

              <tr className="border-b bg-muted/30">
                <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  6.1 — Payment of tax
                </td>
              </tr>
              <Row label="Cash payable after set-off" emphasis {...data.setOff.cashPayable} />
              <Row label="Credit carried forward to next month" {...data.setOff.creditCarried} />
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-start gap-2">
          <Wallet className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">How the set-off worked</h3>
            <p className="text-xs text-muted-foreground">
              The law fixes the order in which credit is used up. You can&apos;t choose — and getting it wrong means
              paying cash you didn&apos;t need to.
            </p>
          </div>
        </div>
        {data.setOff.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credit was available to set off this month.</p>
        ) : (
          <div className="space-y-2">
            {data.setOff.steps.map((step, i) => (
              <div key={i} className="flex items-center gap-3 rounded-md border p-3">
                <Badge variant="secondary" className="shrink-0 tabular text-[10px]">{i + 1}</Badge>
                <span className="min-w-0 flex-1 text-sm">{step.label}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                <Money value={step.amount} className="text-sm font-medium" />
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-start gap-2 rounded-md border bg-muted/40 p-3">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Notice that CGST credit can only clear CGST liability and SGST credit only SGST — they never cross, because
            one belongs to the central government and the other to your state. IGST credit is the flexible one and must
            be used first.
          </p>
        </div>
      </Card>
    </>
  );
}
