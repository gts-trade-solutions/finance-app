'use client';

import { useState } from 'react';
import { Plus, ScrollText, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { Field } from '@/components/shared/form-bits';
import { EmptyState } from '@/components/shared/empty-state';
import { useAppStore, getState, setState } from '@/lib/store';
import { Combobox } from '@/components/ui/combobox';
import { accountOptions } from '@/lib/options';
import { applyBankRules } from '@/lib/services/banking';
import { genId } from '@/lib/ledger/posting';
import type { BankRule } from '@/lib/types';

export default function BankRulesPage() {
  const s = useAppStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', contains: '', accountId: '', autoConfirm: true });

  const save = () => {
    if (!f.name.trim() || !f.contains.trim() || !f.accountId) {
      toast.error('Fill in the rule name, the text to match, and a category.');
      return;
    }
    const rule: BankRule = {
      id: genId('br'),
      name: f.name,
      priority: getState().bankRules.length + 1,
      conditions: [{ field: 'narration', op: 'contains', value: f.contains }],
      actionAccountId: f.accountId,
      autoConfirm: f.autoConfirm,
      isActive: true,
    };
    setState({ bankRules: [...getState().bankRules, rule] });
    toast.success('Rule created');
    setOpen(false);
    setF({ name: '', contains: '', accountId: '', autoConfirm: true });
  };

  const toggle = (id: string, v: boolean) => {
    setState({ bankRules: getState().bankRules.map((r) => (r.id === id ? { ...r, isActive: v } : r)) });
  };

  return (
    <>
      <PageHeader
        title="Bank rules"
        description="Teach the app to categorise repeating transactions so you never code the same fuel bill twice."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const hits = applyBankRules();
                toast.success(`${hits.length} line(s) matched`);
              }}
              className="gap-1.5"
            >
              <Zap className="size-3.5" /> Run all rules
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New rule</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New bank rule</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <Field label="Rule name" required>
                    <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Fuel purchases → Fuel expense" />
                  </Field>
                  <Field label="When the narration contains" required>
                    <Input value={f.contains} onChange={(e) => setF({ ...f, contains: e.target.value })} placeholder="BHARAT PETRO" />
                  </Field>
                  <Field label="Categorise as" required>
                    <Combobox
                      options={accountOptions(s, ['expense', 'income'])}
                      value={f.accountId}
                      onChange={(v) => setF({ ...f, accountId: v })}
                      placeholder="Select account"
                      searchPlaceholder="Search accounts by name or code"
                      showAvatar={false}
                    />
                  </Field>
                  <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">Auto-confirm matches</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Otherwise the match is only suggested for review</p>
                    </div>
                    <Switch checked={f.autoConfirm} onCheckedChange={(v) => setF({ ...f, autoConfirm: v })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save}>Create rule</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {s.bankRules.length === 0 ? (
        <EmptyState icon={ScrollText} title="No rules yet" description="Create a rule to auto-categorise recurring bank lines." />
      ) : (
        <div className="space-y-3">
          {[...s.bankRules].sort((a, b) => a.priority - b.priority).map((r) => {
            const acc = s.accounts.find((a) => a.id === r.actionAccountId);
            return (
              <Card key={r.id} className="flex flex-wrap items-center gap-4 p-4">
                <Badge variant="secondary" className="shrink-0 tabular">#{r.priority}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    When narration contains{' '}
                    {r.conditions.map((c) => (
                      <span key={c.value} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                        {c.value}
                      </span>
                    ))}{' '}
                    → categorise as <span className="font-medium text-foreground">{acc?.name}</span>
                  </p>
                </div>
                {r.autoConfirm && <Badge variant="outline" className="text-[10px]">Auto-confirm</Badge>}
                <Switch checked={r.isActive} onCheckedChange={(v) => toggle(r.id, v)} />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
