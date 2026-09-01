'use client';

// The cheque register — paper in a drawer, not a ledger.
//
// A post-dated cheque changes no balance until it clears. The money is neither
// yours nor theirs while it waits to mature, and booking it early would show
// cash you cannot spend. Marking one cleared here does not post anything: the
// money arriving is a payment, recorded against the invoice or bill it settles,
// or the receipt would exist twice.
//
// What this screen answers is the question the ledger cannot: what is due to
// land next week, and what has bounced.

import { useState } from 'react';
import { FileClock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { StatTile } from '@/components/shared/stat-tile';
import { AsyncPage } from '@/components/shared/async-state';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { api } from '@/lib/api/client';
import { useApi, useApiAction } from '@/lib/api/use-api';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { formatINRCompact } from '@/lib/money';

interface ChequeRow {
  id: string;
  kind: 'issued' | 'received';
  chequeNo: string;
  bankName: string | null;
  contactId: string;
  contactName: string;
  amountPaise: number;
  isPdc: boolean;
  maturityDate: string;
  status: string;
  notes: string | null;
  paymentId: string | null;
}

interface ChequesResponse {
  cheques: ChequeRow[];
  summary: {
    pdcInPaise: number; pdcInCount: number;
    pdcOutPaise: number; pdcOutCount: number;
    bouncedPaise: number; bouncedCount: number;
  };
}

const today = () => new Date().toISOString().slice(0, 10);

const BLANK = {
  kind: 'received' as 'received' | 'issued',
  contactId: '', chequeNo: '', bankName: '', amount: 0, maturityDate: today(), notes: '',
};

export default function ChequesPage() {
  const canEdit = usePermission('banking', 'edit');
  const contacts = useAppStore((s) => s.contacts);

  const state = useApi<ChequesResponse>(() => api.get('/api/banking/cheques'), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);

  const create = useApiAction((input: unknown) =>
    api.post<{ id: string; chequeNo: string; isPdc: boolean }>('/api/banking/cheques', input),
  );
  const setStatus = useApiAction((input: unknown) =>
    api.patch<{ id: string; status: string }>('/api/banking/cheques', input),
  );

  const save = async () => {
    if (!f.contactId || !f.chequeNo.trim() || f.amount <= 0) {
      toast.error('Pick a party, and enter a cheque number and amount.');
      return;
    }
    const done = await create.run({
      kind: f.kind,
      contactId: f.contactId,
      chequeNo: f.chequeNo.trim(),
      bankName: f.bankName || null,
      amountPaise: f.amount,
      maturityDate: f.maturityDate,
      notes: f.notes || null,
    });
    if (!done) {
      toast.error(create.error ?? 'The cheque was not recorded');
      return;
    }
    toast.success(`Cheque ${done.chequeNo} recorded`, {
      description: done.isPdc
        ? 'Post-dated — nothing posts until it matures and clears.'
        : 'Nothing posts until it clears; record the payment then.',
    });
    setOpen(false);
    setF(BLANK);
    state.refetch();
  };

  const mark = async (r: ChequeRow, status: string) => {
    const done = await setStatus.run({ id: r.id, status });
    if (!done) {
      toast.error(setStatus.error ?? 'That could not be changed');
      return;
    }
    if (status === 'bounced') {
      toast.error(`Cheque ${r.chequeNo} marked bounced`, {
        description: 'Chase a replacement — nothing was posted, so no entry needs reversing.',
      });
    } else {
      toast.success(`Cheque ${r.chequeNo} marked ${status.replace('_', ' ')}`, {
        description: status === 'cleared' ? 'Record the payment to put the money in the books.' : undefined,
      });
    }
    state.refetch();
  };

  const cols = (kind: 'received' | 'issued'): Column<ChequeRow>[] => [
    {
      key: 'no', header: 'Cheque no.', sortValue: (r) => r.chequeNo,
      cell: (r) => <span className="font-mono font-medium">{r.chequeNo}</span>,
    },
    {
      key: 'party', header: kind === 'received' ? 'From' : 'To',
      sortValue: (r) => r.contactName, cell: (r) => r.contactName,
    },
    {
      key: 'bank', header: 'Bank', sortValue: (r) => r.bankName ?? '',
      cell: (r) => <span className="text-sm text-muted-foreground">{r.bankName ?? '—'}</span>,
    },
    {
      key: 'maturity', header: 'Maturity', sortValue: (r) => r.maturityDate,
      cell: (r) => {
        const future = r.maturityDate > today();
        return (
          <div className="flex items-center gap-2">
            <span className={future ? 'text-muted-foreground' : undefined}>
              {new Date(r.maturityDate).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: '2-digit',
              })}
            </span>
            {r.isPdc && <Badge variant="outline" className="border-amber-500/40 text-[10px]">PDC</Badge>}
          </div>
        );
      },
    },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => r.amountPaise,
      cell: (r) => <Money value={r.amountPaise} className="font-medium" />,
    },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) =>
        !canEdit || r.status === 'cleared' || r.status === 'bounced' || r.status === 'cancelled' ? null : (
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="outline" disabled={setStatus.busy} onClick={() => void mark(r, 'cleared')}>
              Cleared
            </Button>
            <Button size="xs" variant="outline" disabled={setStatus.busy} onClick={() => void mark(r, 'bounced')}>
              Bounced
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Cheques & post-dated cheques"
        description="A register for cheques in hand, PDCs waiting to mature, and any that bounced."
        actions={
          canEdit && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> Record cheque</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record a cheque</DialogTitle>
                  <DialogDescription>
                    Nothing posts to the ledger here. When it clears, record the payment against the invoice or
                    bill it settles.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Field label="Direction" required>
                    <Combobox
                      options={[
                        { value: 'received', label: 'Received from a customer' },
                        { value: 'issued', label: 'Issued to a supplier' },
                      ]}
                      value={f.kind}
                      onChange={(v) => setF({ ...f, kind: v as 'received' | 'issued', contactId: '' })}
                      showAvatar={false}
                    />
                  </Field>
                  <Field label={f.kind === 'received' ? 'From' : 'To'} required>
                    <Combobox
                      options={contacts
                        .filter((c) =>
                          f.kind === 'received'
                            ? c.kind === 'customer' || c.kind === 'both'
                            : c.kind === 'vendor' || c.kind === 'both',
                        )
                        .map((c) => ({ value: c.id, label: c.displayName }))}
                      value={f.contactId}
                      onChange={(v) => setF({ ...f, contactId: v })}
                      placeholder="Select a party"
                      searchPlaceholder="Search"
                      clearable
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Cheque number" required error={create.fieldErrors.chequeNo}>
                      <Input
                        value={f.chequeNo}
                        onChange={(e) => setF({ ...f, chequeNo: e.target.value })}
                        placeholder="000001"
                        className="font-mono"
                      />
                    </Field>
                    <Field label="Drawn on" hint="The party's bank">
                      <Input
                        value={f.bankName}
                        onChange={(e) => setF({ ...f, bankName: e.target.value })}
                        placeholder="Bank name"
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Amount" required>
                      <MoneyInput valuePaise={f.amount} onChangePaise={(p) => setF({ ...f, amount: p })} />
                    </Field>
                    <Field label="Date on the cheque" required hint="A future date makes it post-dated">
                      <Input
                        type="date"
                        value={f.maturityDate}
                        onChange={(e) => setF({ ...f, maturityDate: e.target.value })}
                      />
                    </Field>
                  </div>
                  {create.error && <p className="text-sm text-destructive">{create.error}</p>}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save} disabled={create.busy}>
                    {create.busy ? 'Saving…' : 'Record cheque'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <AsyncPage state={state}>
        {(d) => {
          const received = d.cheques.filter((c) => c.kind === 'received');
          const issued = d.cheques.filter((c) => c.kind === 'issued');
          return (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile
                  label="PDCs to receive"
                  value={formatINRCompact(d.summary.pdcInPaise)}
                  sub={`${d.summary.pdcInCount} cheque(s) maturing`}
                  tone="positive"
                />
                <StatTile
                  label="PDCs issued"
                  value={formatINRCompact(d.summary.pdcOutPaise)}
                  sub={`${d.summary.pdcOutCount} cheque(s) to honour`}
                  tone="warning"
                />
                <StatTile
                  label="Bounced"
                  value={formatINRCompact(d.summary.bouncedPaise)}
                  sub={`${d.summary.bouncedCount} cheque(s) returned`}
                  tone={d.summary.bouncedCount ? 'danger' : 'default'}
                />
              </div>

              {d.cheques.length === 0 ? (
                <EmptyState
                  icon={FileClock}
                  title="No cheques recorded"
                  description="Track cheques in hand and post-dated cheques here."
                />
              ) : (
                <Tabs defaultValue="received">
                  <TabsList>
                    <TabsTrigger value="received">Received ({received.length})</TabsTrigger>
                    <TabsTrigger value="issued">Issued ({issued.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="received" className="mt-4">
                    <DataTable
                      rows={received}
                      columns={cols('received')}
                      getRowId={(r) => r.id}
                      searchable={false}
                      dateFilter={{ getDate: (r) => r.maturityDate }}
                      emptyMessage="No cheques received."
                    />
                  </TabsContent>
                  <TabsContent value="issued" className="mt-4">
                    <DataTable
                      rows={issued}
                      columns={cols('issued')}
                      getRowId={(r) => r.id}
                      searchable={false}
                      dateFilter={{ getDate: (r) => r.maturityDate }}
                      emptyMessage="No cheques issued."
                    />
                  </TabsContent>
                </Tabs>
              )}
            </>
          );
        }}
      </AsyncPage>
    </>
  );
}
