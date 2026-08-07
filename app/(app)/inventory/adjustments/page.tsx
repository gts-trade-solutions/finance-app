'use client';

import { ClipboardList } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import type { StockMove } from '@/lib/types';

export default function AdjustmentsPage() {
  const s = useAppStore();

  const columns: Column<StockMove>[] = [
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    {
      key: 'item',
      header: 'Item',
      sortValue: (r) => s.items.find((i) => i.id === r.itemId)?.name ?? '',
      cell: (r) => s.items.find((i) => i.id === r.itemId)?.name ?? '—',
    },
    {
      key: 'warehouse',
      header: 'Warehouse',
      sortValue: (r) => s.warehouses.find((w) => w.id === r.warehouseId)?.name ?? '',
      cell: (r) => <span className="text-sm text-muted-foreground">{s.warehouses.find((w) => w.id === r.warehouseId)?.name}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      sortValue: (r) => r.sourceType,
      cell: (r) => <Badge variant="secondary" className="text-[10px] capitalize">{r.sourceType.replace('_', ' ')}</Badge>,
    },
    { key: 'note', header: 'Note', sortValue: (r) => r.note ?? '', cell: (r) => <span className="text-xs text-muted-foreground">{r.note ?? '—'}</span> },
    {
      key: 'qty',
      header: 'Quantity',
      align: 'right',
      sortValue: (r) => r.qty,
      cell: (r) => (
        <span className={'tabular font-medium ' + (r.qty < 0 ? 'text-destructive' : '')}>
          {r.qty > 0 ? '+' : ''}{r.qty}
        </span>
      ),
    },
    { key: 'rate', header: 'Unit cost', align: 'right', sortValue: (r) => r.ratePaise, cell: (r) => <Money value={r.ratePaise} /> },
  ];

  return (
    <>
      <PageHeader
        title="Stock adjustments"
        description="Every movement in and out — opening stock, receipts, issues, damage and shrinkage."
      />

      <Card className="flex items-start gap-3 p-4">
        <ClipboardList className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Adjustments exist because physical stock and recorded stock drift apart — breakage, theft, counting errors,
          samples given away. Recording the difference honestly keeps your stock value and your cost of goods sold
          truthful, which is what your accountant and the tax office are checking.
        </p>
      </Card>

      {s.stockMoves.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No stock movements" description="Opening stock and adjustments appear here." />
      ) : (
        <DataTable rows={s.stockMoves} columns={columns} getRowId={(r) => r.id} initialSort={{ key: 'date', dir: 'desc' }} searchPlaceholder="Search item or note…" />
      )}
    </>
  );
}
