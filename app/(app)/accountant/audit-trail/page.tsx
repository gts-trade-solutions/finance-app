'use client';

import { useMemo, useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore } from '@/lib/store';
import type { AuditEvent } from '@/lib/types';

const ACTION_TONE: Record<string, string> = {
  create: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  update: 'border-blue-500/40 text-blue-700 dark:text-blue-300',
  approve: 'border-blue-500/40 text-blue-700 dark:text-blue-300',
  send: 'border-blue-500/40 text-blue-700 dark:text-blue-300',
  match: 'border-blue-500/40 text-blue-700 dark:text-blue-300',
  void: 'border-red-500/40 text-red-700 dark:text-red-300',
  login: 'border-muted-foreground/30 text-muted-foreground',
};

export default function AuditTrailPage() {
  const s = useAppStore();
  const [entity, setEntity] = useState('all');

  const entities = useMemo(
    () => ['all', ...Array.from(new Set(s.audit.map((a) => a.entity)))],
    [s.audit],
  );

  const rows = entity === 'all' ? s.audit : s.audit.filter((a) => a.entity === entity);

  const columns: Column<AuditEvent>[] = [
    {
      key: 'at',
      header: 'When',
      sortValue: (r) => r.at,
      cell: (r) => (
        <div>
          <p className="text-sm">{new Date(r.at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(r.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
      ),
    },
    {
      key: 'user',
      header: 'Who',
      sortValue: (r) => r.userName,
      cell: (r) => <span className="font-medium">{r.userName}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      sortValue: (r) => r.action,
      cell: (r) => (
        <Badge variant="outline" className={`text-[10px] capitalize ${ACTION_TONE[r.action] ?? ''}`}>
          {r.action}
        </Badge>
      ),
    },
    {
      key: 'entity',
      header: 'Record',
      sortValue: (r) => r.entity,
      cell: (r) => (
        <div>
          <p className="text-sm font-medium">{r.entityLabel}</p>
          <p className="text-xs capitalize text-muted-foreground">{r.entity.replace('_', ' ')}</p>
        </div>
      ),
    },
    {
      key: 'detail',
      header: 'Detail',
      sortValue: (r) => r.detail,
      cell: (r) => <span className="text-sm text-muted-foreground">{r.detail}</span>,
      className: 'whitespace-normal max-w-md',
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every create, change and void — who did it, when, and what changed."
      />

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">Why this can&apos;t be switched off</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Indian companies keeping books electronically must maintain an edit log recording every change to the
            accounts, keep it for eight financial years, and must not be able to disable it. Your auditor has to
            confirm it was running all year. Because our ledger only ever adds entries and never edits or deletes
            them, this record is a by-product of how the system works rather than a feature someone could turn off.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="gap-1 border-emerald-500/40 text-[10px]">
              <Lock className="size-2.5" /> Append-only
            </Badge>
            <Badge variant="outline" className="border-emerald-500/40 text-[10px]">8-year retention</Badge>
            <Badge variant="outline" className="border-emerald-500/40 text-[10px]">No disable switch</Badge>
            <Badge variant="outline" className="border-emerald-500/40 text-[10px]">{s.audit.length} events recorded</Badge>
          </div>
        </div>
      </Card>

      {s.audit.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No activity recorded yet" description="Actions you take will appear here immediately." />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          initialSort={{ key: 'at', dir: 'desc' }}
          searchPlaceholder="Search user, record or detail…"
          toolbar={
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e} value={e} className="capitalize">
                    {e === 'all' ? 'All record types' : e.replace('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      )}
    </>
  );
}
