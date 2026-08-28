'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Locking — Zoho locks per module (Sales, Purchases, Banking,
// Accountant) with its own date and reason, rather than one blunt period close.
// That matters because sales are usually finalised before purchases are, and a
// single lock date forces you to wait for the slowest module.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import {
  BookOpen, Landmark, Lock, ReceiptIndianRupee, ShieldCheck, ShoppingCart, Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { Field } from '@/components/shared/form-bits';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { today } from '@/lib/selectors';
import { logAudit } from '@/lib/services/audit';
import { cn } from '@/lib/utils';

interface ModuleLock {
  key: string;
  label: string;
  icon: typeof Lock;
  blurb: string;
  lockedUpto: string | null;
  reason?: string;
}

const INITIAL: ModuleLock[] = [
  { key: 'sales', label: 'Sales', icon: ReceiptIndianRupee, blurb: 'Invoices, credit notes, payments received', lockedUpto: null },
  { key: 'purchases', label: 'Purchases', icon: ShoppingCart, blurb: 'Bills, expenses, vendor credits, payments made', lockedUpto: null },
  { key: 'banking', label: 'Banking', icon: Landmark, blurb: 'Imports, reconciliation, transfers', lockedUpto: null },
  { key: 'accountant', label: 'Accountant', icon: BookOpen, blurb: 'Manual journals and adjustments', lockedUpto: null },
];

export default function TransactionLockingPage() {
  const s = useAppStore();
  const canLock = usePermission('accountant', 'approve');
  const [locks, setLocks] = useState<ModuleLock[]>(INITIAL);
  const [editing, setEditing] = useState<ModuleLock | null>(null);
  const [lockDate, setLockDate] = useState(today());
  const [reason, setReason] = useState('');

  const lockedCount = locks.filter((l) => l.lockedUpto).length;

  /** Entries that a proposed lock would sit after — i.e. what it protects. */
  const affected = useMemo(() => {
    if (!editing) return 0;
    return s.entries.filter((e) => e.date <= lockDate).length;
  }, [editing, lockDate, s.entries]);

  const applyLock = () => {
    if (!editing) return;
    setLocks((ls) =>
      ls.map((l) =>
        l.key === editing.key ? { ...l, lockedUpto: lockDate, reason: reason || 'Period finalised' } : l,
      ),
    );
    logAudit('approve', 'transaction_lock', editing.key, editing.label,
      `Locked up to ${lockDate} — ${reason || 'Period finalised'}`);
    toast.success(`${editing.label} locked`, {
      description: `Nothing can be posted on or before ${new Date(lockDate).toLocaleDateString('en-IN')}.`,
    });
    setEditing(null);
    setReason('');
  };

  const unlock = (l: ModuleLock) => {
    setLocks((ls) => ls.map((x) => (x.key === l.key ? { ...x, lockedUpto: null, reason: undefined } : x)));
    logAudit('update', 'transaction_lock', l.key, l.label, 'Lock removed');
    toast.info(`${l.label} unlocked`, { description: 'This action is recorded in the audit trail.' });
  };

  return (
    <>
      <PageHeader
        title="Transaction Locking"
        description="Freeze a module up to a date so finalised figures cannot change behind you. Each module locks separately, because sales are usually settled before purchases are."
      />

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">Why locking matters</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Once you have filed a GST return or handed figures to your accountant, those numbers are public.
            If someone then backdates an invoice into that period, your filed return and your books silently stop
            agreeing — and you will not find out until an assessment. A lock makes that impossible rather than
            merely discouraged. Unlocking is allowed, but it is recorded in the audit trail with who did it and when.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {locks.map((l) => (
          <Card key={l.key} className={cn('accent-bar p-5', l.lockedUpto && 'border-primary/30')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <l.icon className="size-4 shrink-0 text-muted-foreground" />
                  <p className="font-medium">{l.label}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{l.blurb}</p>
              </div>
              <Badge
                variant="outline"
                className={cn('shrink-0 text-[10px]', l.lockedUpto ? 'border-primary/40 text-primary' : '')}
              >
                {l.lockedUpto ? 'Locked' : 'Open'}
              </Badge>
            </div>

            <div className="mt-4 flex items-end justify-between gap-3 border-t pt-4">
              <div className="min-w-0">
                <p className="micro-label">Locked up to</p>
                {l.lockedUpto ? (
                  <>
                    <p className="mt-1 text-sm font-medium tabular">
                      {new Date(l.lockedUpto).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{l.reason}</p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">Not locked</p>
                )}
              </div>
              {canLock && (
                l.lockedUpto ? (
                  <Button variant="outline" size="sm" onClick={() => unlock(l)} className="gap-1.5">
                    <Unlock className="size-3.5" /> Unlock
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => { setEditing(l); setLockDate(today()); setReason(''); }}
                    className="gap-1.5"
                  >
                    <Lock className="size-3.5" /> Lock
                  </Button>
                )
              )}
            </div>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {lockedCount} of {locks.length} modules locked. Only an admin or accountant can change a lock.
      </p>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lock {editing?.label}</DialogTitle>
            <DialogDescription>
              Nothing dated on or before the lock date can be created, edited or voided in this module.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Lock transactions up to" required>
              <Input type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} />
            </Field>
            <Field label="Reason" hint="Shown to anyone who hits the lock, and stored in the audit trail">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. GSTR-3B filed for August 2026"
              />
            </Field>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground tabular">{affected}</span> existing journal entr
              {affected === 1 ? 'y' : 'ies'} fall on or before this date and will be protected.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={applyLock}>Lock module</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
