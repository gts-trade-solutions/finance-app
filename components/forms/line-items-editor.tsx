'use client';

// Line-item grid shared by invoices, estimates, sales orders, bills and POs.
// Tax is recomputed live from the resolved supply type as the user types.

import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { MoneyInput } from '@/components/shared/form-bits';
import { Money } from '@/components/shared/money';
import { useAppStore } from '@/lib/store';
import { computeLineTax, GST_RATES } from '@/lib/tax/gst';
import type { SupplyType } from '@/lib/types';

export interface EditorLine {
  key: string;
  itemId: string | null;
  description: string;
  hsnSac: string;
  qty: number;
  uqc: string;
  ratePaise: number;
  discountPct: number;
  gstRatePct: number;
}

export function newEditorLine(key: string): EditorLine {
  return {
    key,
    itemId: null,
    description: '',
    hsnSac: '',
    qty: 1,
    uqc: 'NOS',
    ratePaise: 0,
    discountPct: 0,
    gstRatePct: 18,
  };
}

export function LineItemsEditor({
  lines,
  onChange,
  supplyType,
  priceMode = 'sale',
  showItcColumn = false,
  itcValues,
  onItcChange,
}: {
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  supplyType: SupplyType;
  priceMode?: 'sale' | 'purchase';
  showItcColumn?: boolean;
  itcValues?: Record<string, 'eligible' | 'ineligible' | 'capital_goods'>;
  onItcChange?: (key: string, v: 'eligible' | 'ineligible' | 'capital_goods') => void;
}) {
  // Select the stable array reference, then derive — filtering inside the
  // selector would return a new array each render and loop the store subscription.
  const allItems = useAppStore((s) => s.items);
  const items = useMemo(() => allItems.filter((i) => !i.isArchived), [allItems]);

  const update = (key: string, patch: Partial<EditorLine>) => {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const pickItem = (key: string, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    update(key, {
      itemId,
      description: item.name,
      hsnSac: item.hsnSac,
      uqc: item.uqc,
      ratePaise: priceMode === 'sale' ? item.salePricePaise : item.purchasePricePaise,
      gstRatePct: item.gstRatePct,
    });
  };

  const addLine = () => onChange([...lines, newEditorLine(`l${Date.now()}${lines.length}`)]);
  const removeLine = (key: string) => onChange(lines.filter((l) => l.key !== key));

  const isZeroRated = supplyType === 'export_lut' || supplyType === 'sez' || supplyType === 'nil_or_exempt';

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border thin-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-[26%] px-3 py-2 text-left font-semibold">Item / Description</th>
              <th className="w-[10%] px-2 py-2 text-left font-semibold">HSN/SAC</th>
              <th className="w-[8%] px-2 py-2 text-right font-semibold">Qty</th>
              <th className="w-[13%] px-2 py-2 text-right font-semibold">Rate</th>
              <th className="w-[8%] px-2 py-2 text-right font-semibold">Disc %</th>
              <th className="w-[9%] px-2 py-2 text-right font-semibold">GST %</th>
              {showItcColumn && <th className="w-[11%] px-2 py-2 text-left font-semibold">ITC</th>}
              <th className="w-[13%] px-3 py-2 text-right font-semibold">Amount</th>
              <th className="w-8 px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const { tax, total } = computeLineTax({
                ratePaise: line.ratePaise,
                qty: line.qty,
                discountPct: line.discountPct,
                gstRatePct: line.gstRatePct,
                supplyType,
              });
              return (
                <tr key={line.key} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2">
                    <Select value={line.itemId ?? ''} onValueChange={(v) => pickItem(line.key, v)}>
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue placeholder="Select an item…" />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={line.description}
                      onChange={(e) => update(line.key, { description: e.target.value })}
                      placeholder="Description"
                      className="mt-1 h-7 text-xs"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      value={line.hsnSac}
                      onChange={(e) => update(line.key, { hsnSac: e.target.value })}
                      className="h-8 text-xs"
                      placeholder="HSN"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={line.qty}
                      onChange={(e) => update(line.key, { qty: parseFloat(e.target.value || '0') })}
                      className="h-8 text-right tabular"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <MoneyInput
                      valuePaise={line.ratePaise}
                      onChangePaise={(p) => update(line.key, { ratePaise: p })}
                      className="h-8"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={line.discountPct || ''}
                      onChange={(e) => update(line.key, { discountPct: parseFloat(e.target.value || '0') })}
                      className="h-8 text-right tabular"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Select
                      value={String(line.gstRatePct)}
                      onValueChange={(v) => update(line.key, { gstRatePct: Number(v) })}
                      disabled={isZeroRated}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GST_RATES.map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  {showItcColumn && (
                    <td className="px-2 py-2">
                      <Select
                        value={itcValues?.[line.key] ?? 'eligible'}
                        onValueChange={(v) => onItcChange?.(line.key, v as never)}
                      >
                        <SelectTrigger className="h-8 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="eligible">Eligible</SelectItem>
                          <SelectItem value="ineligible">Ineligible</SelectItem>
                          <SelectItem value="capital_goods">Capital goods</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    <Money value={total} className="text-sm font-medium" />
                    {!isZeroRated && tax.taxablePaise > 0 && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Taxable <Money value={tax.taxablePaise} />
                      </p>
                    )}
                  </td>
                  <td className="px-1 py-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button variant="outline" size="sm" onClick={addLine} className="gap-1.5">
        <Plus className="size-3.5" /> Add line
      </Button>
    </div>
  );
}
