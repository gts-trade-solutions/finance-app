'use client';

import { Building, Package } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { useAppStore } from '@/lib/store';
import { useCanSeeCosts } from '@/lib/store/hooks';
import { stockOnHand } from '@/lib/selectors';

export default function WarehousesPage() {
  const s = useAppStore();
  const canSeeCosts = useCanSeeCosts();
  const stock = stockOnHand(s);

  return (
    <>
      <PageHeader
        title="Warehouses"
        description="Storage locations, each tied to a branch so stock and GST registration stay aligned."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {s.warehouses.map((w) => {
          const branch = s.branches.find((b) => b.id === w.branchId);
          const moves = s.stockMoves.filter((m) => m.warehouseId === w.id);
          const items = new Set(moves.map((m) => m.itemId)).size;
          const value = stock.reduce((t, r) => t + (moves.some((m) => m.itemId === r.itemId) ? r.valuePaise : 0), 0);
          return (
            <Card key={w.id} className="p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <Building className="size-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{w.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{branch?.name}</p>
                  <Badge variant="secondary" className="mt-1.5 font-mono text-[10px]">{branch?.gstin}</Badge>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4">
                <div>
                  <p className="text-xs text-muted-foreground">Distinct items</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold tabular">
                    <Package className="size-3.5 text-muted-foreground" /> {items}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Stock value</p>
                  {canSeeCosts ? (
                    <Money value={value} className="mt-0.5 block text-lg font-semibold" />
                  ) : (
                    <p className="mt-0.5 text-lg font-semibold text-muted-foreground">Hidden</p>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="flex items-start gap-3 p-4">
        <Building className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each warehouse belongs to a branch, and each branch has its own GST registration. That link matters: moving
          stock between warehouses in different states is treated as a supply under GST even though nothing was sold,
          and needs a delivery challan and an e-way bill.
        </p>
      </Card>
    </>
  );
}
