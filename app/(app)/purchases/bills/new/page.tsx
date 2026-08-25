'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { FileText, Loader2, Paperclip, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Combobox } from '@/components/ui/combobox';
import {
  DocumentForm, FormRow, FormRowPair, FormSectionRule,
} from '@/components/shared/form-layout';
import {
  LineItemsEditor, effectiveDiscountPct, newEditorLine, type EditorLine,
} from '@/components/forms/document-lines';
import { useAppStore } from '@/lib/store';
import { today } from '@/lib/selectors';
import {
  branchOptions, dueDateFor, termsForDays, termsOptions, vendorOptions,
} from '@/lib/options';
import { createBill, vendorFyTaxable } from '@/lib/services/purchases';
import { peekNumber } from '@/lib/series';
import { FY_SHORT } from '@/lib/mock/seed/org';
import { computeLineTax, stateName, sumTax, totalTaxPaise } from '@/lib/tax/gst';
import { computeTds, TDS_SECTIONS } from '@/lib/tax/tds';
import { formatINR } from '@/lib/money';

export default function NewBillPage() {
  const router = useRouter();
  const s = useAppStore();

  const [branchId, setBranchId] = useState(s.activeBranchId || s.branches[0]?.id || '');
  const [vendorId, setVendorId] = useState('');
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [date, setDate] = useState(today());
  const [paymentTerms, setPaymentTerms] = useState('net_30');
  const [dueDate, setDueDate] = useState(dueDateFor('net_30', today()));
  const [subject, setSubject] = useState('');
  const [isRcm, setIsRcm] = useState(false);
  const [tdsOverride, setTdsOverride] = useState('');
  const [lines, setLines] = useState<EditorLine[]>([newEditorLine('l1')]);
  const [itc, setItc] = useState<Record<string, 'eligible' | 'ineligible' | 'capital_goods'>>({});
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState(0);
  const [saving, setSaving] = useState(false);

  const vendors = useMemo(() => vendorOptions(s), [s]);
  const branches = useMemo(() => branchOptions(s), [s]);
  const internalNo = useMemo(
    () => (branchId ? peekNumber(s.series, branchId, 'BILL', FY_SHORT) : ''),
    [s.series, branchId],
  );

  const vendor = s.contacts.find((c) => c.id === vendorId);
  const branch = s.branches.find((b) => b.id === branchId);
  const isComposition = vendor?.gstTreatment === 'registered_composition';
  const isUnregistered = vendor?.gstTreatment === 'unregistered';

  const onVendorChange = (id: string) => {
    setVendorId(id);
    const v = s.contacts.find((x) => x.id === id);
    if (!v) return;
    const t = termsForDays(v.paymentTermsDays);
    setPaymentTerms(t);
    setDueDate(dueDateFor(t, date));
    setIsRcm(v.gstTreatment === 'unregistered');
  };

  const onTermsChange = (t: string) => {
    setPaymentTerms(t);
    setDueDate(dueDateFor(t, date));
  };

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
            discountPct: effectiveDiscountPct(l),
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
    const qty = lines.reduce((t, l) => t + (l.qty || 0), 0);
    return { tax, tds, gross, payable: gross - tds.tdsPaise, qty };
  }, [lines, supplyType, isComposition, vendor, tdsOverride, isRcm, vendorId]);

  const valid = !!vendorId && !!vendorInvoiceNo.trim() && lines.some((l) => l.qty > 0 && l.ratePaise > 0);

  const save = () => {
    if (!valid) {
      toast.error('Missing required details', {
        description: "Pick a vendor, enter their invoice number, and add at least one line.",
      });
      return;
    }
    setSaving(true);
    const bill = createBill({
      branchId,
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
          uqc: l.uqc,
          ratePaise: l.ratePaise,
          discountPct: effectiveDiscountPct(l),
          gstRatePct: l.gstRatePct,
          itcEligibility: itc[l.key] ?? 'eligible',
        })),
    });
    toast.success(`Bill ${bill.internalNo} recorded`, {
      description: totals.tds.applies
        ? `TDS of ${formatINR(bill.tdsPaise)} withheld — ${totals.tds.reason}`
        : 'Posted to the ledger with input credit claimed.',
    });
    router.push(`/purchases/bills/${bill.id}`);
  };

  return (
    <DocumentForm
      title="New Bill"
      icon={<FileText className="size-5 text-muted-foreground" />}
      backHref="/purchases/bills"
      footer={
        <>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save Bill
          </Button>
          <Button variant="ghost" onClick={() => router.push('/purchases/bills')} disabled={saving}>
            Cancel
          </Button>
        </>
      }
      footerSummary={
        <>
          <p className="text-sm">
            <span className="text-muted-foreground">Payable to Vendor: </span>
            <span className="font-semibold tabular">{formatINR(totals.payable)}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Total Quantity: <span className="tabular">{totals.qty}</span>
          </p>
        </>
      }
    >
      <div className="space-y-4">
        <FormRow label="Vendor Name" required width="lg">
          <Combobox
            options={vendors}
            value={vendorId}
            onChange={onVendorChange}
            placeholder="Select or add a vendor"
            searchPlaceholder="Search vendors by name or GSTIN"
            createLabel="New Vendor"
            onCreate={() => router.push('/purchases/vendors')}
            clearable
          />
          {vendor && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px] capitalize">
                {vendor.gstTreatment.replace(/_/g, ' ')}
              </Badge>
              <Badge variant="outline" className="text-[10px]">{stateName(vendor.stateCode)}</Badge>
              {vendor.isMsme && (
                <Badge variant="outline" className="border-amber-500/40 text-[10px]">
                  MSME · pay within 45 days
                </Badge>
              )}
              {!vendor.pan && (
                <Badge variant="outline" className="border-destructive/40 text-[10px]">
                  No PAN → TDS at 20%
                </Badge>
              )}
            </div>
          )}
        </FormRow>

        <FormRowPair>
          <FormRow label="Bill#" required hint="As printed on the vendor's document">
            <Input
              value={vendorInvoiceNo}
              onChange={(e) => setVendorInvoiceNo(e.target.value)}
              placeholder="BOS/26-27/1187"
            />
          </FormRow>
          <FormRow label="Order Number">
            <Input
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="Your PO reference"
            />
          </FormRow>
        </FormRowPair>

        <FormRowPair>
          <FormRow label="Bill Date" required>
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setDueDate(dueDateFor(paymentTerms, e.target.value));
              }}
            />
          </FormRow>
          <FormRow label="Payment Terms">
            <Combobox
              options={termsOptions()}
              value={paymentTerms}
              onChange={onTermsChange}
              showAvatar={false}
              placeholder="Select terms"
            />
          </FormRow>
        </FormRowPair>

        <FormRowPair>
          <FormRow label="Due Date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormRow>
          <FormRow label="Branch (GSTIN)" required>
            <Combobox
              options={branches}
              value={branchId}
              onChange={setBranchId}
              placeholder="Select branch"
            />
          </FormRow>
        </FormRowPair>

        <FormRow label="Subject" width="lg">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Brake components — August restock"
          />
        </FormRow>

        <FormRow label="Reference No." width="lg" hint="Our internal bill number in the series">
          <Input value={internalNo} readOnly className="bg-muted/40 font-mono" />
        </FormRow>
      </div>

      {isUnregistered && (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">This vendor isn&apos;t GST-registered</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              For certain supplies from unregistered persons, <em>you</em> pay the GST directly to the government
              instead of the supplier. This is <strong>reverse charge</strong>: you raise a self-invoice, record the
              tax as payable, and claim the same amount back as credit — so it nets to zero, but it must be reported.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Switch checked={isRcm} onCheckedChange={setIsRcm} />
              <span className="text-xs font-medium">Apply reverse charge</span>
            </div>
          </div>
        </div>
      )}

      <FormSectionRule label="Item Table" />

      <LineItemsEditor
        lines={lines}
        onChange={setLines}
        supplyType={supplyType}
        priceMode="purchase"
        showItcColumn={!isComposition}
        itcValues={itc}
        onItcChange={(k, v) => setItc((m) => ({ ...m, [k]: v }))}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[13px] text-field-label">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Internal notes — not shown to the vendor"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setAttachments((n) => n + 1);
              toast.success('File attached');
            }}
            className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <Paperclip className="size-3.5" />
            Attach File(s) to Bill
            {attachments > 0 && <Badge variant="secondary" className="text-[10px]">{attachments}</Badge>}
          </button>
        </div>

        <div className="rounded-md border bg-muted/30 p-4">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Taxable Value</dt>
              <dd className="tabular">{formatINR(totals.tax.taxablePaise)}</dd>
            </div>
            {totals.tax.cgstPaise > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">CGST (input credit)</dt>
                  <dd className="tabular">{formatINR(totals.tax.cgstPaise)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">SGST (input credit)</dt>
                  <dd className="tabular">{formatINR(totals.tax.sgstPaise)}</dd>
                </div>
              </>
            )}
            {totals.tax.igstPaise > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">IGST (input credit)</dt>
                <dd className="tabular">{formatINR(totals.tax.igstPaise)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between border-t pt-2">
              <dt className="text-muted-foreground">Bill Value</dt>
              <dd className="tabular">{formatINR(totals.gross)}</dd>
            </div>

            <div className="space-y-1.5 border-t pt-2">
              <label className="block text-xs text-muted-foreground">
                TDS Section
                {vendor?.tdsSection && (
                  <span className="ml-1 text-[11px]">(vendor default: {vendor.tdsSection})</span>
                )}
              </label>
              <Combobox
                options={TDS_SECTIONS.map((t) => ({
                  value: t.code,
                  label: `${t.code} — ${t.description}`,
                  sublabel: `${t.ratePctWithPan}% with PAN`,
                }))}
                value={tdsOverride}
                onChange={setTdsOverride}
                placeholder={vendor?.tdsSection ?? 'No TDS'}
                showAvatar={false}
                clearable
                className="h-8"
              />
              {totals.tds.applies ? (
                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2.5">
                  <p className="text-xs font-medium">TDS withheld: {formatINR(totals.tds.tdsPaise)}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {totals.tds.reason}. You pay the vendor less and send this to the government on their behalf.
                  </p>
                </div>
              ) : (vendor?.tdsSection || tdsOverride) ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">{totals.tds.reason}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-between border-t pt-2.5 text-base font-semibold">
              <dt>Payable to Vendor</dt>
              <dd className="tabular">{formatINR(totals.payable)}</dd>
            </div>
          </dl>

          {isComposition && (
            <p className="mt-3 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Composition dealers pay a flat rate on turnover and cannot collect GST, so there&apos;s no input
              credit to claim here — the whole amount becomes your cost.
            </p>
          )}
        </div>
      </div>
    </DocumentForm>
  );
}
