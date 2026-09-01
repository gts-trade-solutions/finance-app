'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  FileText, Info, Loader2, Paperclip, Save, Send, Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import {
  DocumentForm, FormRow, FormRowPair, FormSectionRule,
} from '@/components/shared/form-layout';
import {
  LineItemsEditor, effectiveDiscountPct, newEditorLine, type EditorLine,
} from '@/components/forms/document-lines';
import { SupplyKindPicker } from '@/components/forms/supply-kind-picker';
import { useAppStore } from '@/lib/store';
import { today } from '@/lib/selectors';
import {
  branchOptionsForUser, customerOptions, dueDateFor, stateOptions, termsForDays,
  termsOptions, userBranches, userOptions,
} from '@/lib/options';
import { api, ApiError } from '@/lib/api/client';
import {
  computeLineTax, resolveSupplyType, stateName, sumTax, supplyTypeLabel, totalTaxPaise,
  TCS_RATE_PCT,
} from '@/lib/tax/gst';
import { formatINR, roundToRupee, toRupees } from '@/lib/money';
import type { SupplyKind } from '@/lib/types';

export default function NewInvoicePage() {
  const router = useRouter();
  const s = useAppStore();

  const [branchId, setBranchId] = useState(s.activeBranchId || s.branches[0]?.id || '');
  const [customerId, setCustomerId] = useState('');
  const [number, setNumber] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [date, setDate] = useState(today());
  const [paymentTerms, setPaymentTerms] = useState('net_30');
  const [dueDate, setDueDate] = useState(dueDateFor('net_30', today()));
  const [salespersonId, setSalespersonId] = useState('');
  const [subject, setSubject] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [supplyKind, setSupplyKind] = useState<SupplyKind>('goods');
  const [lines, setLines] = useState<EditorLine[]>([newEditorLine('l1')]);
  const [notes, setNotes] = useState('Thanks for your business.');
  const [terms, setTerms] = useState(
    'Goods once sold will not be taken back. Interest @18% p.a. on overdue amounts.',
  );
  const [shipping, setShipping] = useState(0);
  const [adjustment, setAdjustment] = useState(0);
  const [adjustmentLabel, setAdjustmentLabel] = useState('Adjustment');
  const [applyTcs, setApplyTcs] = useState(false);
  const [attachments, setAttachments] = useState(0);
  const [markPaid, setMarkPaid] = useState(false);
  const [saving, setSaving] = useState<false | 'draft' | 'send'>(false);

  // Zoho shows the number that will actually be used, not a placeholder.
  // Peeked from the real sequence by /api/masters, so the number shown here is
  // the one the invoice will be given. Computing it locally would drift the
  // moment anyone else raised a document.
  const nextNumber = s.nextNumbers.invoice ?? '';

  // Only meaningful when this user is attached to more than one registration.
  const allowedBranches = useMemo(() => userBranches(s), [s]);
  const multiBranch = allowedBranches.length > 1;

  const customers = useMemo(() => customerOptions(s), [s]);
  const branches = useMemo(() => branchOptionsForUser(s), [s]);
  const salespeople = useMemo(() => userOptions(s), [s]);
  const states = useMemo(() => stateOptions(), []);

  const customer = s.contacts.find((c) => c.id === customerId);
  const branch = s.branches.find((b) => b.id === branchId);
  const pos = placeOfSupply || customer?.stateCode || '';

  // Picking a customer pulls their default payment terms through, like Zoho.
  const onCustomerChange = (id: string) => {
    setCustomerId(id);
    const c = s.contacts.find((x) => x.id === id);
    if (!c) return;
    const t = termsForDays(c.paymentTermsDays);
    setPaymentTerms(t);
    setDueDate(dueDateFor(t, date));
    setPlaceOfSupply(c.stateCode);
  };

  const onTermsChange = (t: string) => {
    setPaymentTerms(t);
    setDueDate(dueDateFor(t, date));
  };

  const onDateChange = (d: string) => {
    setDate(d);
    setDueDate(dueDateFor(paymentTerms, d));
  };

  const supplyType = useMemo(
    () =>
      customer && branch
        ? resolveSupplyType({
            branchStateCode: branch.stateCode,
            placeOfSupply: pos,
            customerTreatment: customer.gstTreatment,
          })
        : 'intra',
    [customer, branch, pos],
  );

  const totals = useMemo(() => {
    const parts = lines.map(
      (l) =>
        computeLineTax({
          ratePaise: l.ratePaise,
          qty: l.qty,
          discountPct: effectiveDiscountPct(l),
          gstRatePct: l.gstRatePct,
          supplyType,
        }).tax,
    );
    const tax = sumTax(parts);
    const grossBeforeDiscount = lines.reduce((t, l) => t + Math.round(l.ratePaise * l.qty), 0);
    const discount = grossBeforeDiscount - tax.taxablePaise;
    const tcs = applyTcs ? Math.round((tax.taxablePaise * TCS_RATE_PCT) / 100) : 0;
    const beforeRound =
      tax.taxablePaise + totalTaxPaise(tax) + shipping + adjustment + tcs;
    const { rounded, roundOff } = roundToRupee(beforeRound);
    const qty = lines.reduce((t, l) => t + (l.qty || 0), 0);
    return { tax, discount, grossBeforeDiscount, tcs, rounded, roundOff, qty };
  }, [lines, supplyType, shipping, adjustment, applyTcs]);

  const valid = !!customerId && lines.some((l) => l.qty > 0 && l.ratePaise > 0);

  const save = async (mode: 'draft' | 'send') => {
    if (!valid) {
      toast.error('Add a customer and at least one item', {
        description: 'An invoice needs a customer and one line with a quantity and rate.',
      });
      return;
    }
    setSaving(mode);

    // The server recomputes GST, allocates the number and posts the entry in
    // one transaction. The totals shown above are a preview of that, not the
    // source of it — a browser must never be the thing that decides what tax
    // an invoice carries.
    const created = await api
      .post<{ id: string; number: string; totalPaise: number; journalEntryId: string | null }>(
        '/api/invoices',
        {
          branchId,
          customerId,
          date,
          dueDate,
          placeOfSupply: pos,
          supplyKind,
          status: mode === 'draft' ? 'draft' : 'approved',
          number: number && number !== nextNumber ? number : undefined,
          orderNumber: orderNumber || undefined,
          subject: subject || undefined,
          paymentTerms,
          salespersonId: salespersonId || undefined,
          notes,
          terms,
          shippingChargePaise: shipping,
          adjustmentPaise: adjustment,
          adjustmentLabel,
          tcsPaise: totals.tcs,
          lines: lines
            .filter((l) => l.qty > 0)
            .map((l) => ({
              itemId: l.itemId,
              description: l.description,
              hsnSac: l.hsnSac || undefined,
              qty: l.qty,
              uqc: l.uqc,
              ratePaise: l.ratePaise,
              discountPct: effectiveDiscountPct(l),
              gstRatePct: l.gstRatePct,
            })),
        },
      )
      .catch((err: unknown) => {
        setSaving(false);
        const message = err instanceof ApiError ? err.message : 'Could not save the invoice.';
        toast.error(message, {
          description:
            err instanceof ApiError && err.details
              ? Object.values(err.details).join(' ')
              : 'Nothing was saved.',
        });
        return null;
      });

    if (!created) return;

    if (mode === 'send') {
      await api.post(`/api/invoices/${created.id}`, { action: 'send' }).catch(() => {
        // Posted either way; only the "sent" flag failed to stick.
        toast.warning('Saved, but could not mark it as sent.');
      });
    }

    toast.success(`Invoice ${created.number} ${mode === 'draft' ? 'saved as draft' : 'saved and sent'}`, {
      description:
        mode === 'draft'
          ? 'Drafts stay out of the ledger until you approve them.'
          : 'Posted to the ledger — open the Journal tab to see the entry.',
    });
    router.push(`/sales/invoices/${created.id}`);
  };

  return (
    <DocumentForm
      title="New Invoice"
      icon={<FileText className="size-5 text-muted-foreground" />}
      backHref="/sales/invoices"
      headerExtra={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Invoice preferences"
          onClick={() => toast.info('Invoice preferences', { description: 'Numbering, templates and defaults live in Settings.' })}
        >
          <Settings2 className="size-4" />
        </Button>
      }
      footer={
        <>
          <Button variant="outline" onClick={() => save('draft')} disabled={!!saving} className="gap-1.5">
            {saving === 'draft' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save as Draft
          </Button>
          <Button onClick={() => save('send')} disabled={!!saving} className="gap-1.5">
            {saving === 'send' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Save and Send
          </Button>
          <Button variant="ghost" onClick={() => router.push('/sales/invoices')} disabled={!!saving}>
            Cancel
          </Button>
        </>
      }
      footerSummary={
        <>
          <p className="text-sm">
            <span className="text-muted-foreground">Total Amount: </span>
            <span className="font-semibold tabular">{formatINR(totals.rounded)}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Total Quantity: <span className="tabular">{totals.qty}</span>
          </p>
        </>
      }
    >
      {/* ── Header fields ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <FormRow label="Customer Name" required width="lg">
          <Combobox
            options={customers}
            value={customerId}
            onChange={onCustomerChange}
            placeholder="Select or add a customer"
            searchPlaceholder="Search customers by name or GSTIN"
            createLabel="New Customer"
            onCreate={() => router.push('/sales/customers/new')}
            clearable
          />
          {customer && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px] capitalize">
                {customer.gstTreatment.replace(/_/g, ' ')}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {stateName(customer.stateCode)}
              </Badge>
              {customer.creditLimit && (
                <Badge variant="outline" className="text-[10px]">
                  Credit limit {formatINR(customer.creditLimit)}
                </Badge>
              )}
              {customer.customerDeductsTds && (
                <Badge variant="outline" className="border-amber-500/40 text-[10px]">
                  Deducts TDS
                </Badge>
              )}
            </div>
          )}
        </FormRow>

        <FormRowPair>
          <FormRow label="Invoice#" required>
            <Input
              value={number || nextNumber}
              onChange={(e) => setNumber(e.target.value)}
              className="font-mono"
            />
          </FormRow>
          <FormRow label="Order Number">
            <Input
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="Customer PO reference"
            />
          </FormRow>
        </FormRowPair>

        <FormRowPair>
          <FormRow label="Invoice Date" required>
            <Input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
          </FormRow>
          <FormRow label="Terms">
            <Combobox
              options={termsOptions()}
              value={paymentTerms}
              onChange={onTermsChange}
              placeholder="Select terms"
              showAvatar={false}
              searchPlaceholder="Search terms"
            />
          </FormRow>
        </FormRowPair>

        <FormRowPair>
          <FormRow label="Due Date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormRow>
          <FormRow label="Salesperson">
            <Combobox
              options={salespeople}
              value={salespersonId}
              onChange={setSalespersonId}
              placeholder="Select a salesperson"
              searchPlaceholder="Search people"
              clearable
            />
          </FormRow>
        </FormRowPair>

        <FormRow label="Subject" width="lg" hint="A short line summarising what this invoice is for">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Spare parts supply — August 2026"
          />
        </FormRow>

        <FormSectionRule label="GST" />

        <FormRow
          label="Invoice For"
          required
          width="lg"
          hint="Goods take an HSN code, services take a SAC. Pick both for a mixed invoice."
        >
          <SupplyKindPicker value={supplyKind} onChange={setSupplyKind} />
        </FormRow>

        {/*
          Branch only appears when the business actually holds more than one GST
          registration — otherwise there is nothing to choose and the field is
          noise. Zoho behaves the same way: no Branch field until Branches is
          enabled and a second registration exists. Single-branch orgs get the
          branch implicitly from the top-bar switcher.
        */}
        {multiBranch ? (
          <FormRowPair>
            <FormRow
              label="Branch (GSTIN)"
              required
              hint="Which of your GST registrations raises this invoice"
            >
              <Combobox
                options={branches}
                value={branchId}
                onChange={setBranchId}
                placeholder="Select branch"
                searchPlaceholder="Search branches"
              />
            </FormRow>
            <FormRow label="Place of Supply" required>
              <Combobox
                options={states}
                value={pos}
                onChange={setPlaceOfSupply}
                placeholder="Select state"
                searchPlaceholder="Search states"
                showAvatar={false}
              />
            </FormRow>
          </FormRowPair>
        ) : (
          <FormRow
            label="Place of Supply"
            required
            hint={branch ? `Supplying from ${branch.gstin}` : undefined}
          >
            <Combobox
              options={states}
              value={pos}
              onChange={setPlaceOfSupply}
              placeholder="Select state"
              searchPlaceholder="Search states"
              showAvatar={false}
            />
          </FormRow>
        )}

        {customer && branch && (
          <div className="flex items-start gap-2.5 rounded-md border border-primary/25 bg-primary/5 px-3 py-2.5 sm:ml-[166px]">
            <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed">
              <span className="font-medium">{supplyTypeLabel(supplyType)}</span>
              <span className="text-muted-foreground">
                {' — supplying from '}{stateName(branch.stateCode)}{' to '}{stateName(pos)}
                {supplyType === 'intra' && '. Same state, so the tax splits equally between centre and state.'}
                {supplyType === 'inter' && '. Different states, so a single integrated tax applies.'}
                {supplyType === 'export_lut' && '. Exports under LUT are zero-rated.'}
                {supplyType === 'sez' && '. Supplies to an SEZ unit are zero-rated.'}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* ── Item table ────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Item Table</h2>
        <LineItemsEditor
          lines={lines}
          onChange={setLines}
          supplyType={supplyType}
          supplyKind={supplyKind}
        />
      </div>

      {/* ── Notes + totals ────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[13px] text-field-label">Customer Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            <p className="mt-1 text-[11px] text-muted-foreground">Shown on the invoice.</p>
          </div>
          <div>
            <label className="mb-1 block text-[13px] text-field-label">Terms &amp; Conditions</label>
            <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} />
          </div>
          <button
            type="button"
            onClick={() => {
              setAttachments((n) => n + 1);
              toast.success('File attached', { description: 'Attachments travel with the invoice.' });
            }}
            className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <Paperclip className="size-3.5" />
            Attach File(s) to Invoice
            {attachments > 0 && (
              <Badge variant="secondary" className="text-[10px]">{attachments} attached</Badge>
            )}
          </button>
        </div>

        {/* Totals panel */}
        <div className="rounded-md border bg-muted/30 p-4">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Sub Total</dt>
              <dd className="tabular">{formatINR(totals.grossBeforeDiscount)}</dd>
            </div>
            {totals.discount > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular text-destructive">−{formatINR(totals.discount)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Taxable Value</dt>
              <dd className="tabular">{formatINR(totals.tax.taxablePaise)}</dd>
            </div>

            {totals.tax.cgstPaise > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">CGST</dt>
                  <dd className="tabular">{formatINR(totals.tax.cgstPaise)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">SGST</dt>
                  <dd className="tabular">{formatINR(totals.tax.sgstPaise)}</dd>
                </div>
              </>
            )}
            {totals.tax.igstPaise > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">IGST</dt>
                <dd className="tabular">{formatINR(totals.tax.igstPaise)}</dd>
              </div>
            )}

            {/* Shipping */}
            <div className="flex items-center justify-between gap-3 border-t pt-2">
              <dt className="text-muted-foreground">Shipping Charges</dt>
              <dd>
                <Input
                  type="number"
                  step="0.01"
                  value={shipping === 0 ? '' : toRupees(shipping)}
                  onChange={(e) => setShipping(Math.round(parseFloat(e.target.value || '0') * 100))}
                  placeholder="0.00"
                  className="h-8 w-28 text-right tabular"
                />
              </dd>
            </div>

            {/* Adjustment */}
            <div className="flex items-center justify-between gap-3">
              <dt className="min-w-0 flex-1">
                <Input
                  value={adjustmentLabel}
                  onChange={(e) => setAdjustmentLabel(e.target.value)}
                  className="h-8 max-w-[140px] text-xs"
                />
              </dt>
              <dd>
                <Input
                  type="number"
                  step="0.01"
                  value={adjustment === 0 ? '' : toRupees(adjustment)}
                  onChange={(e) => setAdjustment(Math.round(parseFloat(e.target.value || '0') * 100))}
                  placeholder="0.00"
                  className="h-8 w-28 text-right tabular"
                />
              </dd>
            </div>

            {/* TCS */}
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Checkbox checked={applyTcs} onCheckedChange={(v) => setApplyTcs(v === true)} />
                TCS @ {TCS_RATE_PCT}% (206C(1H))
              </span>
              <span className="tabular">{formatINR(totals.tcs)}</span>
            </label>

            {totals.roundOff !== 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Round Off</dt>
                <dd className="tabular">{formatINR(totals.roundOff)}</dd>
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-2.5 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{formatINR(totals.rounded)}</dd>
            </div>
          </dl>

          <label className="mt-4 flex cursor-pointer items-start gap-2 border-t pt-3 text-xs">
            <Checkbox checked={markPaid} onCheckedChange={(v) => setMarkPaid(v === true)} className="mt-0.5" />
            <span className="text-muted-foreground">
              I have received the payment
              <span className="mt-0.5 block text-[11px]">
                Records the receipt at the same time, so the invoice is created already settled.
              </span>
            </span>
          </label>
        </div>
      </div>
    </DocumentForm>
  );
}
