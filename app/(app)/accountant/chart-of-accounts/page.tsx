'use client';

import { useMemo, useState } from 'react';
import { Lock, Plus, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { Field } from '@/components/shared/form-bits';
import { useAppStore, getState, setState } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { accountNets, isDebitNormal } from '@/lib/ledger/reports';
import { genId } from '@/lib/ledger/posting';
import { logAudit } from '@/lib/services/audit';
import type { Account, AccountType } from '@/lib/types';

const TYPE_INFO: Record<AccountType, { label: string; plain: string; tone: string }> = {
  asset: { label: 'Assets', plain: 'What the business owns', tone: 'text-blue-600 dark:text-blue-400' },
  liability: { label: 'Liabilities', plain: 'What the business owes', tone: 'text-amber-600 dark:text-amber-400' },
  equity: { label: 'Equity', plain: "The owners' stake", tone: 'text-purple-600 dark:text-purple-400' },
  income: { label: 'Income', plain: 'What the business earns', tone: 'text-emerald-600 dark:text-emerald-400' },
  expense: { label: 'Expenses', plain: 'What the business spends', tone: 'text-red-600 dark:text-red-400' },
};

const ORDER: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export default function ChartOfAccountsPage() {
  const s = useAppStore();
  const canCreate = usePermission('accountant', 'create');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', name: '', type: 'expense' as AccountType });

  const nets = useMemo(() => accountNets(s.entries), [s.entries]);

  const save = () => {
    if (!f.code.trim() || !f.name.trim()) { toast.error('Code and name are required.'); return; }
    if (s.accounts.some((a) => a.code === f.code)) { toast.error('That account code is already in use.'); return; }
    const acc: Account = {
      id: genId('acc'),
      code: f.code,
      name: f.name,
      type: f.type,
      parentId: null,
      isSystem: false,
      isArchived: false,
    };
    setState({ accounts: [...getState().accounts, acc] });
    logAudit('create', 'account', acc.id, `${acc.code} ${acc.name}`, `New ${f.type} account`);
    toast.success('Account created');
    setOpen(false);
    setF({ code: '', name: '', type: 'expense' });
  };

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        description="The list of buckets every rupee gets sorted into. Everything in the app ultimately lands in one of these."
        actions={
          canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New account</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New account</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <Field label="Account type" required hint={TYPE_INFO[f.type].plain}>
                    <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v as AccountType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ORDER.map((t) => (
                          <SelectItem key={t} value={t}>{TYPE_INFO[t].label} — {TYPE_INFO[t].plain}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="Code" required>
                      <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="6750" className="font-mono" />
                    </Field>
                    <Field label="Account name" required className="col-span-2">
                      <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Software Subscriptions" />
                    </Field>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save}>Create account</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="space-y-6">
        {ORDER.map((type) => {
          const accounts = s.accounts.filter((a) => a.type === type && !a.isArchived).sort((a, b) => a.code.localeCompare(b.code));
          const groupTotal = accounts.reduce((t, a) => {
            const net = nets.get(a.id) ?? 0;
            return t + (isDebitNormal(type) ? net : -net);
          }, 0);
          return (
            <section key={type}>
              <div className="mb-2 flex items-baseline justify-between">
                <div>
                  <h2 className={`text-sm font-semibold ${TYPE_INFO[type].tone}`}>{TYPE_INFO[type].label}</h2>
                  <p className="text-xs text-muted-foreground">{TYPE_INFO[type].plain}</p>
                </div>
                <Money value={groupTotal} className="text-sm font-semibold" />
              </div>
              <Card className="overflow-hidden p-0">
                <table className="w-full text-sm">
                  <tbody>
                    {accounts.map((a) => {
                      const net = nets.get(a.id) ?? 0;
                      const display = isDebitNormal(type) ? net : -net;
                      return (
                        <tr key={a.id} className="border-b last:border-0 hover:bg-accent/40">
                          <td className="w-20 px-4 py-2 font-mono text-xs text-muted-foreground">{a.code}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{a.name}</span>
                              {a.isSystem && (
                                <Badge variant="secondary" className="gap-1 text-[9px]">
                                  <Lock className="size-2.5" /> System
                                </Badge>
                              )}
                            </div>
                            {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                          </td>
                          <td className="w-40 px-4 py-2 text-right">
                            <Money value={display} showZero={false} className={display !== 0 ? 'font-medium' : undefined} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </section>
          );
        })}
      </div>

      <Card className="flex items-start gap-3 p-4">
        <ScrollText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Accounts marked <span className="font-medium">System</span> are wired into how the app posts — Accounts
          Receivable, the GST ledgers, TDS, and so on. They can be renamed but never deleted, because deleting one
          would break the entries that already reference it.
        </p>
      </Card>
    </>
  );
}
