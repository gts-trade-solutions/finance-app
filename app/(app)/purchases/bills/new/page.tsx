'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Info, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { Field, FormSection, TotalRow } from '@/components/shared/form-bits';
import { Money } from '@/components/shared/money';
import {
  LineItemsEditor, newEditorLine, type EditorLine,
} from '@/components/forms/line-items-editor';
import { useAppStore } from '@/lib/store';
import { today, vendors } from '@/lib/selectors';
import { createBill, vendorFyTaxable } from '@/lib/services/purchases';
import { computeLineTax, sumTax, totalTaxPaise } from '@/lib/tax/gst';
import { computeTds, TDS_SECTIONS } from '@/lib/tax/tds';
import { formatINR } from '@/lib/money';

export default function NewBillPage() {
  const router = useRouter();
  const s = useAppStore();
  const vendorList = vendors(s);

  const [vendorId, setVendorId] = useState('');
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('');
  const [date, setDate] = useState(today());
  const [isRcm, setIsRcm] = useState(false);
  const [tdsOverride, setTdsOverride] = useState('');
  const [lines, setLines] = useState<EditorLine[]>([newEditorLine('l1')]);
  const [itc, setItc] = useState<Record<string, 'eligible' | 'ineligible' | 'capital_goods'>>({});

  const vendor = vendorList.find((v) => v.id === vendorId);
  const branch = s.branches.find((b) => b.id === s.activeBranchId);
  const isComposition = vendor?.gstTreatment === 'registered_composition';
  const isUnregistered = vendor?.gstTreatment === 'unregistered';

  const dueDate = useMemo(() => {
    const d = new Date(date);
    d.setDate(d.getDate() + (vendor?.paymentTermsDays ?? 30));
    return d.toISOString().slice(0, 10);
  }, [date, vendor]);

  const supplyType = useMemo(() => {
    if (isComposition) return 'nil_or_exempt' as const;
    if (!vendor || !branch) return 'intra' as const;
    return vendor.stateCode === branch.stateCode ? ('intra' as const) : ('inter' as const);
  }, [vendor, branch, isComposition]);

  const totals = useMemo(() => {
    const tax = sumTax(
      lines.map(
        (l) =>
          computeLineTax({
            ratePaise: l.ratePaise,
            qty: l.qty,
            discountPct: l.discountPct,
            gstRatePct: isComposition ? 0 : l.gstRatePct,
            supplyType,
          }).tax,
      ),
    );
    const sectionCode = tdsOverride || vendor?.tdsSection;
    const tds = computeTds({
      sectionCode,
      hasPan: !!vendor?.pan,
      billTaxable: tax.taxablePaise,
      fyPaidSoFar: vendorId ? vendorFyTaxable(vendorId) : 0,
    });
    const gross = tax.taxablePaise + (isRcm ? 0 : totalTaxPaise(tax));
    return { tax, tds, gross, payable: gross - tds.tdsPaise };
  }, [lines, supplyType, isComposition, vendor, tdsOverride, isRcm, vendorId]);

  const save = () => {
    if (!vendorId || !vendorInvoiceNo.trim()) {
      toast.error("Pick a vendor and enter their invoice number.");
      return;
    }
    if (!lines.some((l) => l.qty > 0 && l.ratePaise > 0)) {
      toast.error('Add at least one line.');
      return;
    }
    const bill = createBill({
      branchId: s.activeBranchId,
      vendorId,
      vendorInvoiceNo,
      date,
      dueDate,
      isRcm,
      tdsSectionOverride: tdsOverride || undefined,
      lines: lines
        .filter((l) => l.qty > 0)
        .map((l) => ({
          itemId: l.itemId,
          description: l.description,
          hsnSac: l.hsnSac,
          qty: l.qty,
          ratePaise: l.ratePaise,
          discountPct: l.discountPct,
          gstRatePct: l.gstRatePct,
          itcEligibility: itc[l.key] ?? 'eligible',
        })),
    });
    toast.success(`Bill ${bill.internalNo} recorded`, {
      description: totals.tds.applies
        ? `TDS of ${formatINR(bill.tdsPaise)} withheld — ${totals.tds.reason}`
        : 'Posted to the ledger with input credit claimed.',
    });
    router.push('/purchases/bills');
  };

  return (
    <>
      <PageHeader
        title="New bill"
        description="Record a supplier invoice. Input credit, reverse charge and TDS are worked out for you."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.back()}>Cancel</Button>
            <Button size="sm" onClick={save} className="gap-1.5"><Save className="size-3.5" /> Save bill</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <FormSection title="Bill details">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vendor" required>
                  <Select value={vendorId} onValueChange={setVendorId}>
                    <SelectTrigger><SelectValue placeholder="Select a vendor…" /></SelectTrigger>
                    <SelectContent>
                      {vendorList.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.displayName}{v.isMsme ? ' · MSME' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Vendor's invoice no." required hint="As printed on their document">
                  <Input value={vendorInvoiceNo} onChange={(e) => setVendorInvoiceNo(e.target.value)} placeholder="BOS/26-27/1187" />
                </Field>
                <Field label="Bill date" required>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Due date" hint={`From ${vendor?.paymentTermsDays ?? 30}-day terms`}>
                  <Input type="date" value={dueDate} readOnly className="bg-muted/40" />
                </Field>
              </div>
            </FormSection>
          </Card>

          <Card className="p-5">
            <FormSection
              title="Items"
              description={isComposition ? 'This vendor is under the composition scheme — they cannot charge GST.' : undefined}
            >
              <LineItemsEditor
                lines={lines}
                onChange={setLines}
                supplyType={supplyType}
                priceMode="purchase"
                showItcColumn={!isComposition}
                itcValues={itc}
                onItcChange={(k, v) => setItc((m) => ({ ...m, [k]: v }))}
              />
            </FormSection>
          </Card>

          {isUnregistered && (
            <Card className="flex items-start gap-3 border-amber-500/40 bg-amber-500/5 p-4">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">This vendor isn&apos;t GST-registered</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  For certain supplies from unregistered persons, <em>you</em> must pay the GST directly to the government
                  instead of the supplier. This is called <strong>reverse charge</strong>. You raise a self-invoice,
                  record the tax as payable, and claim the same amount back as credit — so it nets to zero, but it must be reported.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Switch checked={isRcm} onCheckedChange={setIsRcm} />
                  <span className="text-xs font-medium">Apply reverse charge</span>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="sticky top-20 p-5">
            <h3 className="mb-3 text-sm font-semibold">Totals</h3>

            <TotalRow label="Taxable value"><Money value={totals.tax.taxablePaise} /></TotalRow>
            {totals.tax.cgstPaise > 0 && (
              <>
                <TotalRow label="CGST (input credit)" muted><Money value={totals.tax.cgstPaise} /></TotalRow>
                <TotalRow label="SGST (input credit)" muted><Money value={totals.tax.sgstPaise} /></TotalRow>
              </>
            )}
            {totals.tax.igstPaise > 0 && (
              <TotalRow label="IGST (input credit)" muted><Money value={totals.tax.igstPaise} /></TotalRow>
            )}
            <TotalRow label="Bill value"><Money value={totals.gross} /></TotalRow>

            <div className="mt-3 space-y-3 border-t pt-3">
              <Field label="TDS section" hint={vendor?.tdsSection ? `Vendor default: ${vendor.tdsSection}` : 'None mapped on this vendor'}>
                <Select value={tdsOverride} onValueChange={setTdsOverride}>
                  <SelectTrigger><SelectValue placeholder={vendor?.tdsSection ?? 'No TDS'} /></SelectTrigger>
                  <SelectContent>
                    {TDS_SECTIONS.map((t) => (
                      <SelectItem key={t.code} value={t.code}>{t.code} — {t.ratePctWithPan}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {totals.tds.applies ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  <p className="text-xs font-medium">TDS withheld: {formatINR(totals.tds.tdsPaise)}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{totals.tds.reason}</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    You pay the vendor less and send this amount to the government on their behalf.
                  </p>
                </div>
              ) : vendor?.tdsSection || tdsOverride ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">{totals.tds.reason}</p>
              ) : null}
            </div>

            <div className="mt-3 border-t pt-3">
              <TotalRow label="Payable to vendor" emphasis><Money value={totals.payable} /></TotalRow>
            </div>

            {vendor?.isMsme && (
              <Badge variant="outline" className="mt-4 w-full justify-center border-amber-500/40 text-[11px]">
                MSME vendor — pay within 45 days
              </Badge>
            )}

            {isComposition && (
              <div className="mt-4 flex items-start gap-2 rounded-md border bg-muted/40 p-3">
                <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Composition dealers pay a flat rate on turnover and cannot collect GST, so there&apos;s no input
                  credit to claim here. The whole amount becomes your cost.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
