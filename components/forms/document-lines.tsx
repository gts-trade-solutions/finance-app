'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Item table, matching the Zoho Books layout:
//   ITEM DETAILS | HSN/SAC | QTY | RATE | DISCOUNT | TAX | AMOUNT
// Item selection uses the searchable Combobox, description sits under the item
// name, and discount can be entered as a percentage or a flat rupee amount.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/lib/store';
import { itemOptions } from '@/lib/options';
import { computeLineTax, GST_RATES } from '@/lib/tax/gst';
import { formatINR, toRupees } from '@/lib/money';
import { cn } from '@/lib/utils';
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
  /** Flat rupee discount, used when discountMode is 'amount'. */
  discountPaise: number;
  discountMode: 'percent' | 'amount';
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
    discountPaise: 0,
    discountMode: 'percent',
    gstRatePct: 18,
  };
}

/** Effective discount percentage, whichever way the user entered it. */
export function effectiveDiscountPct(l: EditorLine): number {
  const gross = Math.round(l.ratePaise * l.qty);
  if (l.discountMode === 'amount') {
    return gross > 0 ? (l.discountPaise / gross) * 100 : 0;
  }
  return l.discountPct;
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
  const s = useAppStore();
  const options = useMemo(() => itemOptions(s, priceMode), [s, priceMode]);
  const isZeroRated =
    supplyType === 'export_lut' || supplyType === 'sez' || supplyType === 'nil_or_exempt';

  const update = (key: string, patch: Partial<EditorLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (key: string, itemId: string) => {
    const item = s.items.find((i) => i.id === itemId);
    if (!item) return;
    update(key, {
      itemId,
      description: item.description ?? '',
      hsnSac: item.hsnSac,
      uqc: item.uqc,
      ratePaise: priceMode === 'sale' ? item.salePricePaise : item.purchasePricePaise,
      gstRatePct: item.gstRatePct,
    });
  };

  const addLine = () =>
    onChange([...lines, newEditorLine(`l${lines.length}_${Math.random().toString(36).slice(2, 7)}`)]);

  const addBulk = () => {
    const fresh = Array.from({ length: 3 }, (_, i) =>
      newEditorLine(`b${lines.length + i}_${Math.random().toString(36).slice(2, 7)}`),
    );
    onChange([...lines, ...fresh]);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border thin-scroll">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b bg-muted/60 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="w-[30%] px-3 py-2 text-left">Item Details</th>
              <th className="w-[10%] px-2 py-2 text-left">HSN/SAC</th>
              <th className="w-[9%] px-2 py-2 text-right">Quantity</th>
              <th className="w-[12%] px-2 py-2 text-right">Rate</th>
              <th className="w-[13%] px-2 py-2 text-right">Discount</th>
              <th className="w-[9%] px-2 py-2 text-right">Tax</th>
              {showItcColumn && <th className="w-[10%] px-2 py-2 text-left">ITC</th>}
              <th className="w-[13%] px-3 py-2 text-right">Amount</th>
              <th className="w-9 px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const { tax, total } = computeLineTax({
                ratePaise: line.ratePaise,
                qty: line.qty,
                discountPct: effectiveDiscountPct(line),
                gstRatePct: isZeroRated ? 0 : line.gstRatePct,
                supplyType,
              });
              return (
                <tr key={line.key} className="border-b align-top last:border-0">
                  {/* Item + description */}
                  <td className="px-3 py-2">
                    <Combobox
                      options={options}
                      value={line.itemId ?? ''}
                      onChange={(v) => pickItem(line.key, v)}
                      placeholder="Type or click to select an item"
                      searchPlaceholder="Search items by name, SKU or HSN"
                      showAvatar={false}
                      className="h-8"
                    />
                    <textarea
                      value={line.description}
                      onChange={(e) => update(line.key, { description: e.target.value })}
                      rows={1}
                      placeholder="Add a description"
                      className="mt-1 w-full resize-y rounded border border-input bg-surface px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/25"
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
                    <p className="mt-1 text-right text-[10px] text-muted-foreground">{line.uqc}</p>
                  </td>

                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.ratePaise === 0 ? '' : toRupees(line.ratePaise)}
                      onChange={(e) =>
                        update(line.key, {
                          ratePaise: Math.round(parseFloat(e.target.value || '0') * 100),
                        })
                      }
                      placeholder="0.00"
                      className="h-8 text-right tabular"
                    />
                  </td>

                  {/* Discount with %/₹ toggle, exactly as Zoho does it */}
                  <td className="px-2 py-2">
                    <div className="flex">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          line.discountMode === 'percent'
                            ? line.discountPct || ''
                            : line.discountPaise === 0
                              ? ''
                              : toRupees(line.discountPaise)
                        }
                        onChange={(e) => {
                          const n = parseFloat(e.target.value || '0');
                          update(
                            line.key,
                            line.discountMode === 'percent'
                              ? { discountPct: n }
                              : { discountPaise: Math.round(n * 100) },
                          );
                        }}
                        placeholder="0"
                        className="h-8 rounded-r-none text-right tabular"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          update(line.key, {
                            discountMode: line.discountMode === 'percent' ? 'amount' : 'percent',
                          })
                        }
                        title="Switch between percentage and amount"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-r border border-l-0 border-input bg-muted text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {line.discountMode === 'percent' ? '%' : '₹'}
                      </button>
                    </div>
                  </td>

                  <td className="px-2 py-2">
                    <Select
                      value={String(line.gstRatePct)}
                      onValueChange={(v) => update(line.key, { gstRatePct: Number(v) })}
                      disabled={isZeroRated}
                    >
                      <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {GST_RATES.map((r) => (
                          <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
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
                        <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="eligible">Eligible</SelectItem>
                          <SelectItem value="ineligible">Ineligible</SelectItem>
                          <SelectItem value="capital_goods">Capital goods</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  )}

                  <td className="px-3 py-2 text-right">
                    <p className="pt-1.5 text-sm font-medium tabular">{formatINR(total)}</p>
                    {!isZeroRated && tax.taxablePaise > 0 && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground tabular">
                        Taxable {formatINR(tax.taxablePaise)}
                      </p>
                    )}
                  </td>

                  <td className="px-1 py-2">
                    <button
                      type="button"
                      onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                      disabled={lines.length === 1}
                      aria-label="Remove line"
                      className={cn(
                        'mt-1 grid size-7 place-items-center rounded text-muted-foreground transition-colors',
                        lines.length === 1
                          ? 'cursor-not-allowed opacity-30'
                          : 'hover:bg-destructive/10 hover:text-destructive',
                      )}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={addLine} className="gap-1.5">
          <Plus className="size-3.5" /> Add New Row
        </Button>
        <Button variant="ghost" size="sm" onClick={addBulk} className="gap-1.5 text-primary">
          <Layers className="size-3.5" /> Add Items in Bulk
        </Button>
      </div>
    </div>
  );
}
