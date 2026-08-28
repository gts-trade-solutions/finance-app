'use client';

// ─────────────────────────────────────────────────────────────────────────────
// HSN & SAC — the organisation's approved code list.
//
// Every taxable line on an invoice must carry one of these, and nothing else.
// The reason is GSTR-1 Table 12: the portal validates each code against the
// official master and checks the rate charged against the rate the code
// implies. A typo does not fail quietly — the whole return bounces. Curating
// the list here, once, removes that entire class of filing error, at the cost
// of an admin adding a code when the business starts selling something new.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Boxes, Pencil, Plus, Search, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/shared/form-bits';
import { ReportTable } from '@/components/shared/report-shell';
import { useAppStore, setState } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { logAudit } from '@/lib/services/audit';
import type { HsnCode } from '@/lib/types';
import { cn } from '@/lib/utils';

const KIND_OPTIONS = [
  { value: 'hsn', label: 'HSN — goods' },
  { value: 'sac', label: 'SAC — services' },
];

const RATE_OPTIONS = [0, 0.25, 3, 5, 12, 18, 28].map((r) => ({
  value: String(r),
  label: `${r}%`,
}));

const UQC_OPTIONS = ['NOS', 'PCS', 'KGS', 'LTR', 'MTR', 'BOX', 'SET', 'BAG'].map((u) => ({
  value: u,
  label: u,
}));

const BLANK = {
  code: '',
  kind: 'hsn' as HsnCode['kind'],
  description: '',
  gstRatePct: '18',
  uqc: 'NOS',
};

/**
 * HSN is 4, 6 or 8 digits. SAC is always 6 and always begins 99 — that prefix
 * is what tells the portal a line is a service rather than a good.
 */
function validate(code: string, kind: HsnCode['kind']): string | null {
  if (!/^[0-9]+$/.test(code)) return 'Codes are digits only.';
  if (kind === 'sac') {
    if (code.length !== 6) return 'A SAC is exactly 6 digits.';
    if (!code.startsWith('99')) return 'Every SAC begins with 99.';
    return null;
  }
  if (![4, 6, 8].includes(code.length)) return 'An HSN is 4, 6 or 8 digits.';
  if (code.startsWith('99')) return 'Codes beginning 99 are services — choose SAC.';
  return null;
}

export default function HsnCodesPage() {
  const codes = useAppStore((s) => s.hsnCodes);
  const items = useAppStore((s) => s.items);
  const canEdit = usePermission('settings', 'edit');

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<HsnCode | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...codes].sort((a, b) => a.code.localeCompare(b.code));
    if (!q) return sorted;
    // Same rule the invoice picker uses: codes match by prefix, text anywhere.
    return sorted.filter((c) => c.code.startsWith(q) || c.description.toLowerCase().includes(q));
  }, [codes, query]);

  /** How many catalogue items lean on each code — deleting one in use is a mistake. */
  const usage = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) m[i.hsnSac] = (m[i.hsnSac] ?? 0) + 1;
    return m;
  }, [items]);

  const startNew = () => {
    setEditing(null);
    setF(BLANK);
    setOpen(true);
  };

  const startEdit = (c: HsnCode) => {
    setEditing(c);
    setF({
      code: c.code,
      kind: c.kind,
      description: c.description,
      gstRatePct: String(c.gstRatePct),
      uqc: c.uqc ?? 'NOS',
    });
    setOpen(true);
  };

  const save = () => {
    const code = f.code.trim();
    const err = validate(code, f.kind);
    if (err) {
      toast.error(err);
      return;
    }
    if (!f.description.trim()) {
      toast.error('Add a description so the next person knows what it covers.');
      return;
    }
    if (codes.some((c) => c.code === code && c.id !== editing?.id)) {
      toast.error(`${code} is already on the list.`);
      return;
    }

    const rate = Number(f.gstRatePct);
    if (editing) {
      setState((s) => ({
        hsnCodes: s.hsnCodes.map((c) =>
          c.id === editing.id
            ? { ...c, code, kind: f.kind, description: f.description.trim(), gstRatePct: rate, uqc: f.uqc }
            : c,
        ),
      }));
      logAudit('update', 'hsn_code', editing.id, code, `Updated ${f.kind.toUpperCase()} ${code}`);
      toast.success(`${code} updated`);
    } else {
      const rec: HsnCode = {
        id: `${f.kind}_${code}`,
        code,
        kind: f.kind,
        description: f.description.trim(),
        gstRatePct: rate,
        uqc: f.uqc,
        isActive: true,
      };
      setState((s) => ({ hsnCodes: [...s.hsnCodes, rec] }));
      logAudit('create', 'hsn_code', rec.id, code, `Added ${f.kind.toUpperCase()} ${code} at ${rate}%`);
      toast.success(`${code} added`, { description: 'It is now selectable on invoice lines.' });
    }
    setOpen(false);
  };

  const toggleActive = (c: HsnCode, active: boolean) => {
    setState((s) => ({
      hsnCodes: s.hsnCodes.map((x) => (x.id === c.id ? { ...x, isActive: active } : x)),
    }));
    logAudit('update', 'hsn_code', c.id, c.code, active ? 'Re-enabled' : 'Disabled');
    toast.info(active ? `${c.code} is selectable again` : `${c.code} hidden from new documents`, {
      description: active ? undefined : 'Documents already using it are untouched.',
    });
  };

  const remove = (c: HsnCode) => {
    if (usage[c.code]) {
      toast.error(`${usage[c.code]} item(s) use ${c.code}`, {
        description: 'Disable it instead — deleting would leave those items without a code.',
      });
      return;
    }
    setState((s) => ({ hsnCodes: s.hsnCodes.filter((x) => x.id !== c.id) }));
    logAudit('void', 'hsn_code', c.id, c.code, `Removed ${c.code}`);
    toast.info(`${c.code} removed`);
  };

  const goods = codes.filter((c) => c.kind === 'hsn').length;
  const services = codes.filter((c) => c.kind === 'sac').length;
  const th = 'px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground';

  return (
    <>
      <PageHeader
        title="HSN & SAC Codes"
        description="The only codes your team can put on an invoice. Curated here so nothing invalid ever reaches a GST return."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings">
                <ArrowLeft className="mr-1.5 size-3.5" /> Settings
              </Link>
            </Button>
            {canEdit && (
              <Button size="sm" onClick={startNew} className="gap-1.5">
                <Plus className="size-4" /> New Code
              </Button>
            )}
          </>
        }
      />

      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <div className="flex items-center gap-2 text-sm">
          <Boxes className="size-4 text-muted-foreground" />
          <span className="tabular font-medium">{goods}</span>
          <span className="text-muted-foreground">HSN codes for goods</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Wrench className="size-4 text-muted-foreground" />
          <span className="tabular font-medium">{services}</span>
          <span className="text-muted-foreground">SAC codes for services</span>
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type the first digits, or a description"
            className="pl-8"
          />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={query ? `No code starts with “${query}”` : 'No codes configured'}
          description={
            query
              ? 'Search matches the start of the code, or anywhere in the description.'
              : 'Add the ten or fifteen codes your business actually sells under.'
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ReportTable>
            <thead>
              <tr className="border-b bg-muted/50">
                <th className={cn(th, 'text-left')}>Code</th>
                <th className={cn(th, 'text-left')}>Type</th>
                <th className={cn(th, 'text-left')}>Description</th>
                <th className={cn(th, 'text-right')}>GST</th>
                <th className={cn(th, 'text-right')}>Items</th>
                <th className={cn(th, 'text-center')}>Selectable</th>
                <th className="w-20 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={cn('border-b last:border-0 hover:bg-accent/40', !c.isActive && 'opacity-55')}
                >
                  <td className="px-4 py-2 font-mono text-sm font-medium">{c.code}</td>
                  <td className="px-4 py-2">
                    <Badge variant="outline" className="text-[10px]">
                      {c.kind === 'sac' ? 'SAC' : 'HSN'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-sm text-muted-foreground">{c.description}</td>
                  <td className="px-4 py-2 text-right text-sm tabular">{c.gstRatePct}%</td>
                  <td className="px-4 py-2 text-right text-sm tabular text-muted-foreground">
                    {usage[c.code] ?? 0}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <Switch
                      checked={c.isActive}
                      disabled={!canEdit}
                      onCheckedChange={(v) => toggleActive(c, v)}
                    />
                  </td>
                  <td className="px-4 py-2">
                    {canEdit && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={`Edit ${c.code}`}
                          onClick={() => startEdit(c)}
                          className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${c.code}`}
                          onClick={() => remove(c)}
                          className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </Card>
      )}

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <Boxes className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Sales users cannot type a code that is not on this list — the invoice picker offers these and nothing
          else. Disabling a code hides it from new documents but leaves every invoice that already used it exactly
          as filed, because a posted document must always report the code it was filed under.
        </p>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.code}` : 'Add a code'}</DialogTitle>
            <DialogDescription>
              Use the code exactly as it appears in the GST master. The rate here becomes the default when a line
              picks this code without an item behind it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Applies to" required>
              <Combobox
                options={KIND_OPTIONS}
                value={f.kind}
                onChange={(v) => setF({ ...f, kind: v as HsnCode['kind'] })}
                showAvatar={false}
              />
            </Field>
            <Field
              label="Code"
              required
              hint={f.kind === 'sac' ? 'Six digits, beginning 99' : 'Four, six or eight digits'}
            >
              <Input
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.replace(/[^0-9]/g, '').slice(0, 8) })}
                placeholder={f.kind === 'sac' ? '998729' : '8708'}
                className="font-mono"
                inputMode="numeric"
              />
            </Field>
            <Field label="Description" required hint="What the code covers, in your own words">
              <Input
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
                placeholder="Parts and accessories of motor vehicles"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default GST rate" required>
                <Combobox
                  options={RATE_OPTIONS}
                  value={f.gstRatePct}
                  onChange={(v) => setF({ ...f, gstRatePct: v })}
                  showAvatar={false}
                />
              </Field>
              {f.kind === 'hsn' && (
                <Field label="Unit (UQC)" hint="The unit GSTR-1 expects">
                  <Combobox
                    options={UQC_OPTIONS}
                    value={f.uqc}
                    onChange={(v) => setF({ ...f, uqc: v })}
                    showAvatar={false}
                  />
                </Field>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? 'Save changes' : 'Add code'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
