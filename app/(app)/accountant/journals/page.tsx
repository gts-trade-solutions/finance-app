'use client';

// Manual journals — the primitive underneath every other screen.
//
// Each line is one-sided: a debit or a credit, never both. The two columns must
// agree exactly before anything can be posted, and the server enforces that
// again on arrival. An entry that does not balance is not a warning to be
// dismissed; it is an entry that cannot exist.

import { useState } from 'react';
import { BookOpen, Plus, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { AsyncPage } from '@/components/shared/async-state';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { JournalEntryTable } from '@/components/shared/journal-table';
import {
  accounts as accountsApi, journal,
  type AccountRow, type JournalEntryRow, type JournalResponse,
} from '@/lib/api/client';
import { useApi, useApiAction } from '@/lib/api/use-api';
import { usePermission } from '@/lib/store/hooks';

interface DraftRow { key: string; accountId: string; debit: number; credit: number; description: string }

const emptyRow = (k: string): DraftRow => ({ key: k, accountId: '', debit: 0, credit: 0, description: '' });
const today = () => new Date().toISOString().slice(0, 10);

export default function JournalsPage() {
  const canCreate = usePermission('accountant', 'create');

  // Manual and opening entries only. Everything else on this ledger was posted
  // by a document, and belongs on that document's screen rather than here.
  const state = useApi<JournalResponse>(
    () => journal.list({ sourceType: 'manual,opening', limit: 300 }),
    [],
  );
  const chart = useApi<{ accounts: AccountRow[] }>(() => accountsApi.list(), []);

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([emptyRow('r1'), emptyRow('r2')]);
  const [viewing, setViewing] = useState<JournalEntryRow | null>(null);

  const create = useApiAction(journal.create);
  const reverse = useApiAction(journal.reverse);

  const totalDr = rows.reduce((t, r) => t + r.debit, 0);
  const totalCr = rows.reduce((t, r) => t + r.credit, 0);
  const balanced = totalDr === totalCr && totalDr > 0;

  const accountChoices = (chart.data?.accounts ?? []).map((a) => ({
    value: a.id,
    label: a.name,
    sublabel: `${a.code} · ${a.type}`,
  }));

  const update = (key: string, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!memo.trim()) {
      toast.error('Add a narration so the entry can be understood later.');
      return;
    }
    const result = await create.run({
      date,
      memo: memo.trim(),
      lines: rows
        .filter((r) => r.accountId && (r.debit > 0 || r.credit > 0))
        .map((r) => ({
          accountId: r.accountId,
          debitPaise: r.debit,
          creditPaise: r.credit,
          description: r.description || null,
        })),
    });
    if (!result) {
      toast.error(create.error ?? 'The entry was not posted');
      return;
    }
    toast.success(`Journal entry #${result.entryNo} posted`);
    setOpen(false);
    setRows([emptyRow('r1'), emptyRow('r2')]);
    setMemo('');
    state.refetch();
  };

  const doReverse = async (r: JournalEntryRow) => {
    const done = await reverse.run(r.id, `Manual reversal of JE #${r.entryNo}`);
    if (!done) {
      toast.error(reverse.error ?? 'Could not reverse that entry');
      return;
    }
    toast.success(`Reversal posted as #${done.entryNo}`, {
      description: 'The original entry stays in the books — nothing is ever deleted.',
    });
    state.refetch();
  };

  const columns: Column<JournalEntryRow>[] = [
    { key: 'no', header: 'JE #', sortValue: (r) => r.entryNo, cell: (r) => <span className="font-mono font-medium">#{r.entryNo}</span> },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    {
      key: 'memo', header: 'Narration', sortValue: (r) => r.memo ?? '',
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span>{r.memo}</span>
          {r.reversalOf && <Badge variant="outline" className="border-destructive/40 text-[9px]">Reversal</Badge>}
          {r.sourceType === 'opening' && <Badge variant="secondary" className="text-[9px]">Opening</Badge>}
        </div>
      ),
    },
    { key: 'lines', header: 'Lines', align: 'center', sortValue: (r) => r.lines.length, cell: (r) => r.lines.length },
    {
      key: 'amount', header: 'Amount', align: 'right',
      sortValue: (r) => r.totalDebitPaise,
      cell: (r) => <Money value={r.totalDebitPaise} className="font-medium" />,
    },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); setViewing(r); }}>
            View
          </Button>
          {canCreate && !r.reversalOf && (
            <Button
              size="xs"
              variant="outline"
              className="gap-1"
              disabled={reverse.busy}
              onClick={(e) => { e.stopPropagation(); void doReverse(r); }}
            >
              <Undo2 className="size-3" /> Reverse
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Manual journals"
        description="The raw primitive underneath every other screen. Nothing posts unless debits equal credits exactly."
        actions={
          canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New journal</Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>New journal entry</DialogTitle>
                  <DialogDescription>
                    Each line is one-sided — either a debit or a credit. The two columns must agree before this
                    can be saved.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Date" required>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                  <Field label="Narration" required className="sm:col-span-2">
                    <Input
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="What this entry records"
                    />
                  </Field>
                </div>

                <div className="overflow-x-auto rounded-lg border thin-scroll">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 text-left font-semibold">Account</th>
                        <th className="px-3 py-2 text-left font-semibold">Description</th>
                        <th className="px-3 py-2 text-right font-semibold">Debit</th>
                        <th className="px-3 py-2 text-right font-semibold">Credit</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            <Combobox
                              options={accountChoices}
                              value={r.accountId}
                              onChange={(v) => update(r.key, { accountId: v })}
                              placeholder="Select account"
                              searchPlaceholder="Search accounts by name or code"
                              showAvatar={false}
                              className="h-8"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={r.description}
                              onChange={(e) => update(r.key, { description: e.target.value })}
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <MoneyInput
                              valuePaise={r.debit}
                              onChangePaise={(p) => update(r.key, { debit: p, credit: p > 0 ? 0 : r.credit })}
                              className="h-8 w-32"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <MoneyInput
                              valuePaise={r.credit}
                              onChangePaise={(p) => update(r.key, { credit: p, debit: p > 0 ? 0 : r.debit })}
                              className="h-8 w-32"
                            />
                          </td>
                          <td className="px-1 py-2">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                              disabled={rows.length <= 2}
                            >
                              <Trash2 className="size-3.5 text-muted-foreground" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-muted/40 font-semibold">
                        <td className="px-3 py-2" colSpan={2}>Total</td>
                        <td className="px-3 py-2 text-right"><Money value={totalDr} /></td>
                        <td className="px-3 py-2 text-right"><Money value={totalCr} /></td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRows((rs) => [...rs, emptyRow(`r${rs.length + 1}${Date.now()}`)])}
                    className="gap-1.5"
                  >
                    <Plus className="size-3.5" /> Add line
                  </Button>
                  <Badge
                    variant="outline"
                    className={
                      balanced
                        ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                        : 'border-amber-500/40 text-amber-700 dark:text-amber-300'
                    }
                  >
                    {balanced
                      ? 'Balanced — ready to post'
                      : `Out of balance by ₹${(Math.abs(totalDr - totalCr) / 100).toLocaleString('en-IN')}`}
                  </Badge>
                </div>

                {create.error && <p className="text-sm text-destructive">{create.error}</p>}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save} disabled={!balanced || create.busy}>
                    {create.busy ? 'Posting…' : 'Post journal'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Manual journals are for things no document covers — depreciation, accruals, corrections, year-end
          adjustments. Everywhere else in the app, entries like these are created for you automatically.
        </p>
      </Card>

      <AsyncPage state={state}>
        {(d) => (
          <DataTable
            rows={d.entries}
            columns={columns}
            getRowId={(r) => r.id}
            initialSort={{ key: 'no', dir: 'desc' }}
            dateFilter={{ getDate: (r) => r.date }}
            searchPlaceholder="Search narration…"
            emptyMessage="No manual journals yet."
          />
        )}
      </AsyncPage>

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Journal entry detail</DialogTitle></DialogHeader>
          {viewing && <JournalEntryTable entry={viewing} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
