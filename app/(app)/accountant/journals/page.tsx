'use client';

import { useState } from 'react';
import { BookOpen, Plus, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { Field, MoneyInput } from '@/components/shared/form-bits';
import { JournalTable } from '@/components/shared/journal-table';
import { useAppStore } from '@/lib/store';
import { Combobox } from '@/components/ui/combobox';
import { accountOptions } from '@/lib/options';
import { usePermission } from '@/lib/store/hooks';
import { today } from '@/lib/selectors';
import { createManualJournal, reverseEntry } from '@/lib/services/journal';
import { UnbalancedEntryError } from '@/lib/ledger/posting';
import type { JournalEntry } from '@/lib/types';

interface DraftRow { key: string; accountId: string; debit: number; credit: number; description: string }

const emptyRow = (k: string): DraftRow => ({ key: k, accountId: '', debit: 0, credit: 0, description: '' });

export default function JournalsPage() {
  const s = useAppStore();
  const canCreate = usePermission('accountant', 'create');
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([emptyRow('r1'), emptyRow('r2')]);
  const [viewId, setViewId] = useState<string | null>(null);

  const totalDr = rows.reduce((t, r) => t + r.debit, 0);
  const totalCr = rows.reduce((t, r) => t + r.credit, 0);
  const balanced = totalDr === totalCr && totalDr > 0;

  const update = (key: string, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = () => {
    if (!memo.trim()) { toast.error('Add a narration so the entry can be understood later.'); return; }
    try {
      createManualJournal({
        date,
        memo,
        lines: rows
          .filter((r) => r.accountId && (r.debit > 0 || r.credit > 0))
          .map((r) => ({ accountId: r.accountId, debit: r.debit, credit: r.credit, description: r.description })),
      });
      toast.success('Journal entry posted');
      setOpen(false);
      setRows([emptyRow('r1'), emptyRow('r2')]);
      setMemo('');
    } catch (e) {
      if (e instanceof UnbalancedEntryError) {
        toast.error('Entry does not balance', {
          description: 'Total debits must equal total credits exactly. The entry was not posted.',
        });
      } else {
        toast.error((e as Error).message);
      }
    }
  };

  const manual = s.entries.filter((e) => e.sourceType === 'manual' || e.sourceType === 'opening');

  const columns: Column<JournalEntry>[] = [
    { key: 'no', header: 'JE #', sortValue: (r) => r.entryNo, cell: (r) => <span className="font-mono font-medium">#{r.entryNo}</span> },
    { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => new Date(r.date).toLocaleDateString('en-IN') },
    {
      key: 'memo',
      header: 'Narration',
      sortValue: (r) => r.memo,
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span>{r.memo}</span>
          {r.isReversalOf && <Badge variant="outline" className="border-destructive/40 text-[9px]">Reversal</Badge>}
          {r.sourceType === 'opening' && <Badge variant="secondary" className="text-[9px]">Opening</Badge>}
        </div>
      ),
    },
    { key: 'lines', header: 'Lines', align: 'center', sortValue: (r) => r.lines.length, cell: (r) => r.lines.length },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortValue: (r) => r.lines.reduce((t, l) => t + l.debit, 0),
      cell: (r) => <Money value={r.lines.reduce((t, l) => t + l.debit, 0)} className="font-medium" />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); setViewId(r.id); }}>
            View
          </Button>
          {canCreate && !r.isReversalOf && (
            <Button
              size="xs"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                reverseEntry(r.id, today(), 'Manual reversal');
                toast.success('Reversal posted', { description: 'The original entry stays in the books.' });
              }}
              className="gap-1"
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
                    Each line is one-sided — either a debit or a credit. The two columns must agree before this can be saved.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Date" required>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                  <Field label="Narration" required className="sm:col-span-2">
                    <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Depreciation for August 2026" />
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
                              options={accountOptions(s)}
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

                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save} disabled={!balanced}>Post journal</Button>
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

      <DataTable
        rows={manual}
        columns={columns}
        getRowId={(r) => r.id}
        initialSort={{ key: 'no', dir: 'desc' }}
        searchPlaceholder="Search narration…"
        emptyMessage="No manual journals yet."
      />

      <Dialog open={!!viewId} onOpenChange={(v) => !v && setViewId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Journal entry detail</DialogTitle></DialogHeader>
          {viewId && <JournalTable entryId={viewId} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
