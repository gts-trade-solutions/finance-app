'use client';

// The quick-create dialog shared by estimates, orders, challans and credit
// notes.
//
// All four ask the same four questions — customer, item, quantity, rate — and
// then differ only in the one extra field their kind needs: a validity date, a
// ship date, a purpose, a reason. Four near-identical dialogs would drift.
//
// It deliberately handles the single-line case only. Anything with several
// lines belongs on a full document form, not in a modal.

import { useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { Money } from '@/components/shared/money';
import { salesDocuments, type SalesDocKind } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api';
import { useAppStore } from '@/lib/store';
import { customerOptions, itemOptions } from '@/lib/options';

/** yyyy-mm-dd, n days from today. */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const TODAY = () => new Date().toISOString().slice(0, 10);

export function QuickDocumentDialog({
  kind,
  title,
  description,
  buttonLabel,
  extra,
  onCreated,
}: {
  kind: SalesDocKind;
  title: string;
  description: string;
  buttonLabel: string;
  /** Renders the one field this kind needs beyond the shared four. */
  extra?: (value: string, set: (v: string) => void) => ReactNode;
  onCreated: () => void;
}) {
  // Customers, items and the active branch come from the store, which is
  // hydrated from /api/masters — the same ids the server will validate against.
  const branchId = useAppStore((s) => s.activeBranchId);
  const customers = useAppStore((s) => s.contacts);
  const items = useAppStore((s) => s.items);

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState(1);
  const [rate, setRate] = useState(0);
  const [gstRatePct, setGstRatePct] = useState(18);
  const [extraValue, setExtraValue] = useState('');

  const create = useApiAction(salesDocuments.create);

  const customerChoices = useMemo(
    () => customerOptions({ contacts: customers } as never),
    [customers],
  );
  const itemChoices = useMemo(() => itemOptions({ items } as never), [items]);

  // Shown live so nobody is surprised by the tax on the document they just made.
  const preview = useMemo(() => {
    const taxable = Math.round(rate * qty);
    const tax = Math.round((taxable * gstRatePct) / 100);
    return { taxable, tax, total: taxable + tax };
  }, [rate, qty, gstRatePct]);

  const reset = () => {
    setCustomerId('');
    setItemId('');
    setQty(1);
    setRate(0);
    setExtraValue('');
    create.reset();
  };

  const save = async () => {
    if (!customerId || !itemId) {
      toast.error('Pick a customer and an item.');
      return;
    }

    const base = {
      kind,
      branchId,
      customerId,
      date: TODAY(),
      lines: [{ itemId, qty, ratePaise: rate, gstRatePct }],
    };

    const payload =
      kind === 'estimate' ? { ...base, expiryDate: extraValue || inDays(15), status: 'sent' as const }
      : kind === 'sales-order' ? { ...base, expectedShipDate: extraValue || inDays(14) }
      : kind === 'challan' ? { ...base, challanType: extraValue || 'other' }
      : { ...base, reason: extraValue };

    if (kind === 'credit-note' && !extraValue.trim()) {
      toast.error('A credit note needs a reason — it is reported in GSTR-1.');
      return;
    }

    const result = await create.run(payload);
    if (!result) return;

    toast.success(`${result.number} created`, {
      description:
        result.journalEntryId
          ? 'Posted to the ledger.'
          : 'Nothing posts to the ledger — no sale has happened yet.',
    });
    setOpen(false);
    reset();
    onCreated();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="size-4" /> {buttonLabel}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Customer" required error={create.fieldErrors.customerId}>
            <Combobox
              options={customerChoices}
              value={customerId}
              onChange={setCustomerId}
              placeholder="Select a customer"
              searchPlaceholder="Search customers"
              clearable
            />
          </Field>
          <Field label="Item" required>
            <Combobox
              options={itemChoices}
              value={itemId}
              onChange={(v) => {
                setItemId(v);
                const picked = items.find((i) => i.id === v);
                setRate(picked?.salePricePaise ?? 0);
                setGstRatePct(picked?.gstRatePct ?? 18);
              }}
              placeholder="Select an item"
              searchPlaceholder="Search items by name, SKU or HSN"
              showAvatar={false}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantity">
              <Input
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>
            <Field label="Rate">
              <MoneyInput valuePaise={rate} onChangePaise={setRate} />
            </Field>
          </div>
          {extra?.(extraValue, setExtraValue)}

          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              Taxable <Money value={preview.taxable} /> · GST {gstRatePct}% <Money value={preview.tax} />
            </span>
            <Money value={preview.total} className="font-semibold" />
          </div>

          {create.error && <p className="text-sm text-destructive">{create.error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={create.busy}>
            {create.busy ? 'Saving…' : buttonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
