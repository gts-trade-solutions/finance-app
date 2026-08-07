'use client';

import { useMemo } from 'react';
import { AlertTriangle, Boxes, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatTile } from '@/components/shared/stat-tile';
import { useAppStore } from '@/lib/store';
import { useCanSeeCosts } from '@/lib/store/hooks';
import { stockOnHand } from '@/lib/selectors';
import { formatINRCompact } from '@/lib/money';

type Row = ReturnType<typeof stockOnHand>[number];

export default function StockPage() {
  const s = useAppStore();
  const canSeeCosts = useCanSeeCosts();
  const rows = useMemo(() => stockOnHand(s), [s]);

  const totalValue = rows.reduce((t, r) => t + r.valuePaise, 0);
  const lowStock = rows.filter((r) => r.qty <= r.reorderLevel);
  const outOfStock = rows.filter((r) => r.qty <= 0);

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Item',
      sortValue: (r) => r.name,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-muted-foreground">{r.sku}</p>
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'On hand',
      align: 'right',
      sortValue: (r) => r.qty,
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          {r.qty <= 0 ? (
            <Badge variant="outline" className="border-red-500/40 text-[9px] text-red-600 dark:text-red-400">Out of stock</Badge>
          ) : r.qty <= r.reorderLevel ? (
            <Badge variant="outline" className="border-amber-500/40 text-[9px] text-amber-700 dark:text-amber-300">Reorder</Badge>
          ) : null}
          <span className="tabular font-medium">{r.qty}</span>
        </div>
      ),
    },
    { key: 'reorder', header: 'Reorder at', align: 'right', sortValue: (r) => r.reorderLevel, cell: (r) => <span className="tabular text-muted-foreground">{r.reorderLevel}</span> },
    ...(canSeeCosts
      ? [{
          key: 'value',
          header: 'Stock value',
          align: 'right' as const,
          sortValue: (r: Row) => r.valuePaise,
          cell: (r: Row) => <Money value={r.valuePaise} className="font-medium" />,
        }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Stock on hand"
        description="Live quantities derived from opening stock, purchases received and units invoiced out."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Stock value" value={canSeeCosts ? formatINRCompact(totalValue) : 'Hidden'} icon={Boxes} />
        <StatTile label="Below reorder level" value={String(lowStock.length)} sub="Time to buy" tone={lowStock.length ? 'warning' : 'positive'} icon={AlertTriangle} />
        <StatTile label="Out of stock" value={String(outOfStock.length)} sub="Cannot fulfil orders" tone={outOfStock.length ? 'danger' : 'positive'} />
      </div>

      <Card className="flex items-start gap-3 p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Quantities here are calculated, not stored — opening stock plus everything received on bills, minus everything
          sold on invoices. Valuation uses weighted average cost. In the production build, each movement also posts to
          the ledger so the Inventory Asset figure on your Balance Sheet always ties back to this list.
        </p>
      </Card>

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(r) => r.itemId}
        initialSort={{ key: 'qty', dir: 'asc' }}
        searchPlaceholder="Search item or SKU…"
      />
    </>
  );
}
