'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Info, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { customers, today } from '@/lib/selectors';
import { createInvoice, markInvoiceSent } from '@/lib/services/sales';
import {
  computeLineTax, GST_STATES, resolveSupplyType, stateName, sumTax,
  supplyTypeLabel, totalTaxPaise,
} from '@/lib/tax/gst';
import { roundToRupee } from '@/lib/money';

export default function NewInvoicePage() {
  const router = useRouter();
  const s = useAppStore();
  const branches = s.branches;
  const custList = customers(s);

  const [branchId, setBranchId] = useState(s.activeBranchId || branches[0]?.id);
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(today());
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [lines, setLines] = useState<EditorLine[]>([newEditorLine('l1')]);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState(
    'Goods once sold will not be taken back. Interest @18% p.a. on overdue amounts.',
  );

  const customer = custList.find((c) => c.id === customerId);
  const branch = branches.find((b) => b.id === branchId);
  const pos = placeOfSupply || customer?.stateCode || '';

  const dueDate = useMemo(() => {
    const d = new Date(date);
    d.setDate(d.getDate() + (customer?.paymentTermsDays ?? 30));
    return d.toISOString().slice(0, 10);
  }, [date, customer]);

  // Live GST resolution — the heart of the demo
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
          discountPct: l.discountPct,
          gstRatePct: l.gstRatePct,
          supplyType,
        }).tax,
    );
    const tax = sumTax(parts);
    const gross = tax.taxablePaise + totalTaxPaise(tax);
    const { rounded, roundOff } = roundToRupee(gross);
    return { tax, gross, rounded, roundOff };
  }, [lines, supplyType]);

  const valid =
    !!customerId && lines.some((l) => l.qty > 0 && l.ratePaise > 0) && totals.rounded > 0;

  const save = (send: boolean) => {
    if (!valid) {
      toast.error('Pick a customer and add at least one line with a quantity and rate.');
      return;
    }
    const inv = createInvoice({
      branchId,
      customerId,
      date,
      dueDate,
      placeOfSupply: pos,
      status: 'approved',
      notes,
      terms,
      lines: lines
        .filter((l) => l.qty > 0)
        .map((l) => ({
          itemId: l.itemId,
          description: l.description,
          hsnSac: l.hsnSac,
          qty: l.qty,
          uqc: l.uqc,
          ratePaise: l.ratePaise,
          discountPct: l.discountPct,
          gstRatePct: l.gstRatePct,
        })),
    });
    if (send) markInvoiceSent(inv.id);
    toast.success(`Invoice ${inv.number} created`, {
      description: send
        ? 'Emailed to the customer and posted to the ledger.'
        : 'Posted to the ledger. Journal entry created.',
    });
    router.push(`/sales/invoices/${inv.id}`);
  };

  return (
    <>
      <PageHeader
        title="New invoice"
        description="Tax is resolved live from your branch state and the customer's place of supply."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={() => save(false)} className="gap-1.5">
              <Save className="size-3.5" /> Save
            </Button>
            <Button size="sm" onClick={() => save(true)} className="gap-1.5">
              <Send className="size-3.5" /> Save &amp; send
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <FormSection title="Invoice details">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Customer" required>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a customer…" />
                    </SelectTrigger>
                    <SelectContent>
                      {custList.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.displayName}
                          {c.gstin ? ` · ${c.gstin}` : ' · Unregistered'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Branch (GSTIN)" required hint={branch ? `Supplying from ${stateName(branch.stateCode)}` : undefined}>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} · {b.gstin}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Invoice date" required>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>

                <Field
                  label="Due date"
                  hint={`Auto from ${customer?.paymentTermsDays ?? 30}-day payment terms`}
                >
                  <Input type="date" value={dueDate} readOnly className="bg-muted/40" />
                </Field>

                <Field
                  label="Place of supply"
                  required
                  className="sm:col-span-2"
                  hint="Changing this switches the tax between CGST+SGST and IGST"
                >
                  <Select value={pos} onValueChange={setPlaceOfSupply}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select state…" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(GST_STATES).map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {code} — {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </FormSection>
          </Card>

          <Card className="p-5">
            <FormSection title="Items">
              <LineItemsEditor lines={lines} onChange={setLines} supplyType={supplyType} />
            </FormSection>
          </Card>

          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Notes to customer">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Thanks for your business…"
                />
              </Field>
              <Field label="Terms & conditions">
                <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} />
              </Field>
            </div>
          </Card>
        </div>

        {/* Live totals + tax explanation */}
        <div className="space-y-4">
          <Card className="sticky top-20 p-5">
            <h3 className="mb-3 text-sm font-semibold">Totals</h3>

            {customer && (
              <div className="mb-4 rounded-md border bg-muted/40 p-3">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <div className="min-w-0 text-xs">
                    <p className="font-medium">{supplyTypeLabel(supplyType)}</p>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      {branch && `Supplying from ${stateName(branch.stateCode)} (${branch.stateCode})`}
                      {pos && ` to ${stateName(pos)} (${pos})`}
                      {supplyType === 'intra' && ' — same state, so the tax splits equally between centre and state.'}
                      {supplyType === 'inter' && ' — different states, so a single integrated tax applies.'}
                      {supplyType === 'export_lut' && ' — exports under LUT are zero-rated.'}
                      {supplyType === 'sez' && ' — supplies to an SEZ unit are zero-rated.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <TotalRow label="Taxable value">
              <Money value={totals.tax.taxablePaise} />
            </TotalRow>
            {totals.tax.cgstPaise > 0 && (
              <>
                <TotalRow label="CGST" muted>
                  <Money value={totals.tax.cgstPaise} />
                </TotalRow>
                <TotalRow label="SGST" muted>
                  <Money value={totals.tax.sgstPaise} />
                </TotalRow>
              </>
            )}
            {totals.tax.igstPaise > 0 && (
              <TotalRow label="IGST" muted>
                <Money value={totals.tax.igstPaise} />
              </TotalRow>
            )}
            {totals.roundOff !== 0 && (
              <TotalRow label="Round off" muted>
                <Money value={totals.roundOff} />
              </TotalRow>
            )}
            <TotalRow label="Total" emphasis>
              <Money value={totals.rounded} />
            </TotalRow>

            {customer?.creditLimit && (
              <div className="mt-4 rounded-md border p-3 text-xs">
                <p className="text-muted-foreground">Credit limit</p>
                <p className="mt-0.5 font-medium">
                  <Money value={customer.creditLimit} />
                </p>
              </div>
            )}

            {s.org?.aatoAbove5Cr && customer?.gstin && (
              <Badge variant="secondary" className="mt-4 w-full justify-center text-[11px]">
                E-invoice (IRN) required for this customer
              </Badge>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
