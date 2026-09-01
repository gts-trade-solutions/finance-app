'use client';

// Stock on hand.
//
// Nothing here is stored. Each quantity is opening, plus what the bills brought
// in, less what the invoices sent out, plus or minus adjustments — computed on
// the request from the documents themselves. A stored running quantity could
// only be a second copy to fall out of step with them, and a stock figure that
// disagrees with the purchase and sales history is worse than no figure at all.
//
// Negative stock is shown rather than netted away. It means the documents
// disagree with what is on the shelf, and hiding it would hide the problem.

import { AlertTriangle, Boxes, Info, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatTile } from '@/components/shared/stat-tile';
import { EmptyState } from '@/components/shared/empty-state';
import { AsyncPage } from '@/components/shared/async-state';
import { inventory, type StockResponse, type StockRow } from '@/lib/api/client';
import { useApi } from '@/lib/api/use-api';
import { useCanSeeCosts } from '@/lib/store/hooks';
import { formatINRCompact } from '@/lib/money';

export default function StockPage() {
  const canSeeCosts = useCanSeeCosts();
  const state = useApi<StockResponse>(() => inventory.stock(), []);

  const columns: Column<StockRow>[] = [
    {
      key: 'name', header: 'Item', sortValue: (r) => r.name,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-muted-foreground">{r.sku ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'movement', header: 'Movement', sortValue: (r) => r.boughtQty,
      cell: (r) => (
        <span className="text-xs text-muted-foreground tabular">
          {r.openingQty} opening + {r.boughtQty} in − {r.soldQty} out
          {r.adjustedQty !== 0 && (r.adjustedQty > 0 ? ` + ${r.adjustedQty} adj` : ` − ${-r.adjustedQty} adj`)}
        </span>
      ),
    },
    {
      key: 'qty', header: 'On hand', align: 'right', sortValue: (r) => r.qty,
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          {r.qty < 0 ? (
            <Badge variant="outline" className="border-red-500/40 text-[9px] text-red-600 dark:text-red-400">
              Negative
            </Badge>
          ) : r.qty === 0 ? (
            <Badge variant="outline" className="border-red-500/40 text-[9px] text-red-600 dark:text-red-400">
              Out of stock
            </Badge>
          ) : r.qty <= r.reorderLevel ? (
            <Badge variant="outline" className="border-amber-500/40 text-[9px] text-amber-700 dark:text-amber-300">
              Reorder
            </Badge>
          ) : null}
          <span className="tabular font-medium">
            {r.qty} <span className="text-xs font-normal text-muted-foreground">{r.uqc.toLowerCase()}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'reorder', header: 'Reorder at', align: 'right', sortValue: (r) => r.reorderLevel,
      cell: (r) => <span className="tabular text-muted-foreground">{r.reorderLevel || '—'}</span>,
    },
    ...(canSeeCosts
      ? [
          {
            key: 'cost',
            header: 'Avg. cost',
            align: 'right' as const,
            sortValue: (r: StockRow) => r.unitCostPaise,
            cell: (r: StockRow) => <Money value={r.unitCostPaise} className="text-muted-foreground" />,
          },
          {
            key: 'value',
            header: 'Stock value',
            align: 'right' as const,
            sortValue: (r: StockRow) => r.valuePaise,
            cell: (r: StockRow) => <Money value={r.valuePaise} className="font-medium" />,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Stock on hand"
        description="Live quantities derived from opening stock, purchases received and units invoiced out."
      />

      <AsyncPage state={state}>
        {(d) => (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Stock value"
                value={canSeeCosts ? formatINRCompact(d.summary.totalValuePaise) : 'Hidden'}
                sub={`${d.summary.tracked} item(s) tracked`}
                icon={Boxes}
              />
              <StatTile
                label="Below reorder level"
                value={String(d.summary.lowStock)}
                sub="Time to buy"
                tone={d.summary.lowStock ? 'warning' : 'positive'}
                icon={AlertTriangle}
              />
              <StatTile
                label="Out of stock"
                value={String(d.summary.outOfStock)}
                sub="Cannot fulfil orders"
                tone={d.summary.outOfStock ? 'danger' : 'positive'}
              />
            </div>

            {d.summary.negative > 0 && (
              <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-4">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {d.summary.negative} item(s) show negative stock.
                  </span>{' '}
                  More has been invoiced out than was ever recorded coming in — usually a bill that was never
                  entered, or an opening quantity that was never set. The figure is left as it is rather than
                  clamped to zero, because clamping it would hide the missing document.
                </p>
              </Card>
            )}

            <Card className="flex items-start gap-3 p-4">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Quantities are calculated, not stored — opening stock plus everything received on bills, minus
                everything sold on invoices, plus any adjustment. Valuation is weighted average cost, taken from
                what was actually paid on the bills rather than the catalogue price. Adjustments post to the ledger,
                so the Inventory figure on the balance sheet moves with them.
              </p>
            </Card>

            {d.items.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="No stocked items"
                description="Only goods carry stock. Add an item under Sales → Items to see it here."
              />
            ) : (
              <DataTable
                rows={d.items}
                columns={columns}
                getRowId={(r) => r.itemId}
                initialSort={{ key: 'qty', dir: 'asc' }}
                searchPlaceholder="Search item or SKU…"
              />
            )}
          </>
        )}
      </AsyncPage>
    </>
  );
}
