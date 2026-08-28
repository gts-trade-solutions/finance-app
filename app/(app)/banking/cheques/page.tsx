'use client';

import { FileClock } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { StatTile } from '@/components/shared/stat-tile';
import { useAppStore } from '@/lib/store';
import { contactName, today } from '@/lib/selectors';
import { setChequeStatus } from '@/lib/services/banking';
import { formatINRCompact } from '@/lib/money';
import type { Cheque } from '@/lib/types';

export default function ChequesPage() {
  const s = useAppStore();

  const cols = (kind: 'received' | 'issued'): Column<Cheque>[] => [
    { key: 'no', header: 'Cheque no.', sortValue: (r) => r.chequeNo, cell: (r) => <span className="font-mono font-medium">{r.chequeNo}</span> },
    { key: 'party', header: kind === 'received' ? 'From' : 'To', sortValue: (r) => contactName(s, r.contactId), cell: (r) => contactName(s, r.contactId) },
    { key: 'bank', header: 'Bank', sortValue: (r) => r.bankName, cell: (r) => <span className="text-sm text-muted-foreground">{r.bankName}</span> },
    {
      key: 'maturity',
      header: 'Maturity',
      sortValue: (r) => r.maturityDate,
      cell: (r) => {
        const future = r.maturityDate > today();
        return (
          <div className="flex items-center gap-2">
            <span className={future ? 'text-muted-foreground' : undefined}>
              {new Date(r.maturityDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
            </span>
            {r.isPdc && <Badge variant="outline" className="border-amber-500/40 text-[10px]">PDC</Badge>}
          </div>
        );
      },
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => r.amountPaise, cell: (r) => <Money value={r.amountPaise} className="font-medium" /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        r.status === 'cleared' || r.status === 'bounced' ? null : (
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="outline" onClick={() => { setChequeStatus(r.id, 'cleared'); toast.success('Marked cleared'); }}>
              Cleared
            </Button>
            <Button size="xs" variant="outline" onClick={() => { setChequeStatus(r.id, 'bounced'); toast.error('Marked bounced'); }}>
              Bounced
            </Button>
          </div>
        ),
    },
  ];

  const received = s.cheques.filter((c) => c.kind === 'received');
  const issued = s.cheques.filter((c) => c.kind === 'issued');
  const pdcIn = received.filter((c) => c.isPdc && c.status === 'in_hand');
  const pdcOut = issued.filter((c) => c.isPdc && c.status === 'in_hand');
  const bounced = s.cheques.filter((c) => c.status === 'bounced');

  return (
    <>
      <PageHeader
        title="Cheques & post-dated cheques"
        description="A register for cheques in hand, PDCs waiting to mature, and any that bounced."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="PDCs to receive"
          value={formatINRCompact(pdcIn.reduce((t, c) => t + c.amountPaise, 0))}
          sub={`${pdcIn.length} cheque(s) maturing`}
          tone="positive"
        />
        <StatTile
          label="PDCs issued"
          value={formatINRCompact(pdcOut.reduce((t, c) => t + c.amountPaise, 0))}
          sub={`${pdcOut.length} cheque(s) to honour`}
          tone="warning"
        />
        <StatTile
          label="Bounced"
          value={formatINRCompact(bounced.reduce((t, c) => t + c.amountPaise, 0))}
          sub={`${bounced.length} cheque(s) returned`}
          tone={bounced.length ? 'danger' : 'default'}
        />
      </div>

      {s.cheques.length === 0 ? (
        <EmptyState icon={FileClock} title="No cheques recorded" description="Track cheques in hand and post-dated cheques here." />
      ) : (
        <Tabs defaultValue="received">
          <TabsList>
            <TabsTrigger value="received">Received ({received.length})</TabsTrigger>
            <TabsTrigger value="issued">Issued ({issued.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="received" className="mt-4">
            <DataTable rows={received} columns={cols('received')} getRowId={(r) => r.id} searchable={false} dateFilter={{ getDate: (r) => r.maturityDate }} />
          </TabsContent>
          <TabsContent value="issued" className="mt-4">
            <DataTable rows={issued} columns={cols('issued')} getRowId={(r) => r.id} searchable={false} dateFilter={{ getDate: (r) => r.maturityDate }} />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
