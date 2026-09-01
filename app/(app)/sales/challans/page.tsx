'use client';

// Delivery challans — goods moving without a sale.
//
// Sending parts to a job worker, or out on approval, is not a supply: ownership
// has not changed hands. No GST is charged and nothing reaches the ledger. The
// value is carried anyway, because the goods still need insuring and an e-way
// bill still needs a figure on it.

import { Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { AsyncPage } from '@/components/shared/async-state';
import { Field } from '@/components/shared/form-bits';
import { QuickDocumentDialog } from '@/components/shared/quick-document-dialog';
import { salesDocuments, type SalesDocListResponse, type SalesDocRow } from '@/lib/api/client';
import { useApi } from '@/lib/api/use-api';
import { usePermission } from '@/lib/store/hooks';

const TYPE_LABEL: Record<string, string> = {
  job_work: 'Job work',
  supply_on_approval: 'Supply on approval',
  liquid_gas: 'Liquid gas',
  other: 'Other',
};

const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }));

const short = (d: string) => new Date(d).toLocaleDateString('en-IN');

const columns: Column<SalesDocRow>[] = [
  { key: 'number', header: 'Challan #', sortValue: (r) => r.number, cell: (r) => <span className="font-medium">{r.number}</span> },
  { key: 'customer', header: 'Consignee', sortValue: (r) => r.customerName, cell: (r) => r.customerName },
  { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => short(r.date) },
  {
    key: 'type', header: 'Purpose', sortValue: (r) => r.detail ?? '',
    cell: (r) => (
      <Badge variant="secondary" className="text-[10px]">
        {TYPE_LABEL[r.detail ?? 'other'] ?? r.detail}
      </Badge>
    ),
  },
  { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
  { key: 'value', header: 'Goods value', align: 'right', sortValue: (r) => r.totalPaise, cell: (r) => <Money value={r.totalPaise} /> },
];

export default function ChallansPage() {
  const canCreate = usePermission('sales', 'create');
  const state = useApi<SalesDocListResponse>(() => salesDocuments.list('challan'), []);

  return (
    <>
      <PageHeader
        title="Delivery challans"
        description="Goods moving without a sale — job work, approval-basis supply, or branch transfers. No GST is charged and nothing posts to the ledger."
        actions={
          canCreate && (
            <QuickDocumentDialog
              kind="challan"
              title="New delivery challan"
              description="Move goods without selling them. No tax is charged and nothing posts — ownership has not changed."
              buttonLabel="New challan"
              onCreated={state.refetch}
              extra={(v, set) => (
                <Field label="Purpose" hint="Why the goods are leaving">
                  <Combobox
                    options={TYPE_OPTIONS}
                    value={v || 'other'}
                    onChange={set}
                    showAvatar={false}
                  />
                </Field>
              )}
            />
          )
        }
      />
      <AsyncPage state={state}>
        {(d) =>
          d.documents.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No delivery challans"
              description="Used when goods leave your premises but no sale has happened yet."
            />
          ) : (
            <DataTable
              rows={d.documents}
              columns={columns}
              getRowId={(r) => r.id}
              initialSort={{ key: 'date', dir: 'desc' }}
              dateFilter={{ getDate: (r) => r.date }}
              searchPlaceholder="Search challan or consignee…"
            />
          )
        }
      </AsyncPage>
    </>
  );
}
