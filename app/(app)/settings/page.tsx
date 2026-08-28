'use client';

import Link from 'next/link';

import { useState } from 'react';
import {
  Building2, Code2, FileText, KeyRound, Plug, ScrollText,
  ShieldCheck, Sliders, Webhook, Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { Field } from '@/components/shared/form-bits';
import { Money } from '@/components/shared/money';
import { useAppStore, getState, setState } from '@/lib/store';
import { hasPermission } from '@/lib/store/hooks';
import { formatDocNumber } from '@/lib/series';
import { FY_SHORT } from '@/lib/mock/seed/org';

const ROLE_MATRIX: { role: string; scope: string }[] = [
  { role: 'Admin', scope: 'Everything, including settings, period locks and voiding documents.' },
  { role: 'Accountant', scope: 'Full books, banking, GST and journals. Cannot change org settings.' },
  { role: 'Sales', scope: 'Quotes, invoices and customers. Purchase costs and profit are hidden.' },
  { role: 'Staff', scope: 'Create documents only — no approvals, no reports.' },
  { role: 'Viewer', scope: 'Read-only across the app. For auditors and stakeholders.' },
];

export default function SettingsPage() {
  const s = useAppStore();
  const [org, setOrg] = useState(s.org);
  const canEdit = hasPermission(s.session?.role, 'settings', 'edit');

  const saveOrg = () => {
    if (org) setState({ org });
    toast.success('Organisation settings saved');
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organisation, users, numbering, automation and the developer platform."
      />

      <Tabs defaultValue="org">
        <TabsList className="flex-wrap">
          <TabsTrigger value="org">Organisation</TabsTrigger>
          <TabsTrigger value="users">Users &amp; roles</TabsTrigger>
          <TabsTrigger value="numbering">Numbering</TabsTrigger>
          <TabsTrigger value="fields">Custom fields</TabsTrigger>
          <TabsTrigger value="workflows">Automation</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="api">Developer API</TabsTrigger>
        </TabsList>

        {/* Organisation */}
        <TabsContent value="org" className="mt-4 space-y-4">
          <Card className="space-y-5 p-5">
            <h3 className="text-sm font-semibold">Organisation details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name">
                <Input value={org?.name ?? ''} onChange={(e) => setOrg(org && { ...org, name: e.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="PAN">
                <Input value={org?.pan ?? ''} onChange={(e) => setOrg(org && { ...org, pan: e.target.value })} className="font-mono" disabled={!canEdit} />
              </Field>
              <Field label="Email">
                <Input value={org?.email ?? ''} onChange={(e) => setOrg(org && { ...org, email: e.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="Phone">
                <Input value={org?.phone ?? ''} onChange={(e) => setOrg(org && { ...org, phone: e.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="Financial year" hint="India runs April to March" className="sm:col-span-2">
                <Input value={`${org?.fiscalYearLabel} · ${org?.fiscalYearStart} to ${org?.fiscalYearEnd}`} readOnly className="bg-muted/40" />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Turnover above ₹5 crore</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Turns on mandatory e-invoicing — B2B invoices must be registered with the IRP.
                </p>
              </div>
              <Switch
                checked={org?.aatoAbove5Cr ?? false}
                onCheckedChange={(v) => setOrg(org && { ...org, aatoAbove5Cr: v })}
                disabled={!canEdit}
              />
            </div>
            {canEdit && <Button size="sm" onClick={saveOrg}>Save changes</Button>}
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Branches &amp; GST registrations</h3>
            <div className="space-y-2">
              {s.branches.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <Building2 className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{b.name}</p>
                      {b.isPrimary && <Badge variant="secondary" className="text-[9px]">Primary</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{b.address}</p>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">{b.gstin}</Badge>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Each state you operate in needs its own GST registration, and each registration keeps its own invoice
              number series. That&apos;s why branches sit at the heart of the app rather than being an afterthought.
            </p>
          </Card>

          <Card className="flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">HSN &amp; SAC codes</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                The approved code list your team may pick from on invoice lines. Nothing outside it can be
                entered, which is what keeps GSTR-1 from bouncing on an invalid code.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings/hsn-codes">Manage codes</Link>
            </Button>
          </Card>
        </TabsContent>

        {/* Users */}
        <TabsContent value="users" className="mt-4 space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Users</h3>
                <p className="text-xs text-muted-foreground">Unlimited users on every plan.</p>
              </div>
              <Badge variant="outline" className="border-emerald-500/40 text-[10px]">{s.users.length} active</Badge>
            </div>
            <div className="space-y-2">
              {s.users.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: u.avatarColor }}
                  >
                    {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <Badge variant="secondary" className="capitalize">{u.role}</Badge>
                  {u.id === s.session?.userId && <Badge variant="outline" className="text-[9px]">You</Badge>}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-primary" /> What each role can do
            </h3>
            <div className="space-y-2">
              {ROLE_MATRIX.map((r) => (
                <div key={r.role} className="flex gap-3 rounded-md border p-3">
                  <Badge variant="outline" className="h-fit shrink-0">{r.role}</Badge>
                  <p className="text-xs leading-relaxed text-muted-foreground">{r.scope}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Use the <span className="font-medium text-foreground">Demo</span> menu in the top bar to switch role and
              watch the navigation and buttons change.
            </p>
          </Card>
        </TabsContent>

        {/* Numbering */}
        <TabsContent value="numbering" className="mt-4">
          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold">Document numbering</h3>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              GST law requires invoice numbers to run consecutively without gaps, stay within 16 characters, and use
              only letters, digits, hyphens and slashes. Each branch and financial year gets its own sequence.
            </p>
            <div className="overflow-x-auto rounded-lg border thin-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold">Branch</th>
                    <th className="px-3 py-2 text-left font-semibold">Document</th>
                    <th className="px-3 py-2 text-left font-semibold">Next number</th>
                    <th className="px-3 py-2 text-right font-semibold">Issued so far</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(s.series).map(([key, next]) => {
                    const [branchId, docType] = key.split(':');
                    const branch = s.branches.find((b) => b.id === branchId);
                    return (
                      <tr key={key} className="border-b last:border-0">
                        <td className="px-3 py-2">{branch?.name ?? branchId}</td>
                        <td className="px-3 py-2"><Badge variant="secondary" className="text-[10px]">{docType}</Badge></td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {formatDocNumber(docType as never, FY_SHORT, next)}
                        </td>
                        <td className="px-3 py-2 text-right tabular">{next - 1}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Custom fields */}
        <TabsContent value="fields" className="mt-4">
          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold">Custom fields</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Extra fields for information specific to your trade — vehicle numbers, job cards, docket references.
            </p>
            <div className="space-y-2">
              {s.customFields.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <Sliders className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{f.label}</p>
                    <p className="text-xs text-muted-foreground">
                      On {f.entity} · {f.fieldType}
                      {f.options && ` (${f.options.join(', ')})`}
                    </p>
                  </div>
                  {f.showOnPdf && <Badge variant="outline" className="text-[9px]">Prints on PDF</Badge>}
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* Workflows */}
        <TabsContent value="workflows" className="mt-4 space-y-4">
          <Card className="p-5">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Workflow className="size-4 text-primary" /> Workflow rules
            </h3>
            <p className="mb-4 text-xs text-muted-foreground">
              When something happens, do something about it — without anyone remembering to.
            </p>
            <div className="space-y-2">
              {s.workflows.map((w) => (
                <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{w.name}</p>
                      <Badge variant="secondary" className="text-[9px]">{w.module}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="text-foreground">When</span> {w.trigger} ·{' '}
                      <span className="text-foreground">if</span> {w.conditionSummary} ·{' '}
                      <span className="text-foreground">then</span> {w.actionSummary}
                    </p>
                  </div>
                  <Switch
                    checked={w.isActive}
                    onCheckedChange={(v) => {
                      setState({ workflows: getState().workflows.map((x) => (x.id === w.id ? { ...x, isActive: v } : x)) });
                      toast.info(v ? 'Rule enabled' : 'Rule paused');
                    }}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold">Approval thresholds</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Documents above these values need a second pair of eyes before they go out.
            </p>
            <div className="space-y-2">
              {s.approvals.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.module}</p>
                    <p className="text-xs text-muted-foreground">
                      Above <Money value={a.thresholdPaise} /> requires <span className="capitalize">{a.approverRole}</span> approval
                    </p>
                  </div>
                  <Switch checked={a.isActive} onCheckedChange={() => toast.info('Approval rule updated')} />
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="mt-4 space-y-3">
          {[
            { name: 'GST Suvidha Provider', desc: 'E-invoice IRN, e-way bills and GSTR-2B downloads.', status: 'Connected', icon: ShieldCheck },
            { name: 'Razorpay', desc: 'Payment links on invoices and settlement reconciliation.', status: 'Connected', icon: Plug },
            { name: 'Account Aggregator bank feeds', desc: 'Daily transaction sync from your banks.', status: 'Connected', icon: Plug },
            { name: 'AWS SES', desc: 'Invoice delivery and payment reminders.', status: 'Connected', icon: FileText },
            { name: 'WhatsApp Business', desc: 'Send invoices from your business number.', status: 'Not connected', icon: Plug },
            { name: 'Tally import', desc: 'Bring masters and vouchers across from Tally.', status: 'Available', icon: ScrollText },
          ].map((i) => (
            <Card key={i.name} className="flex flex-wrap items-center gap-3 p-4">
              <div className="rounded-lg bg-primary/10 p-2">
                <i.icon className="size-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{i.name}</p>
                <p className="text-xs text-muted-foreground">{i.desc}</p>
              </div>
              <Badge
                variant="outline"
                className={i.status === 'Connected' ? 'border-emerald-500/40 text-[10px]' : 'text-[10px]'}
              >
                {i.status}
              </Badge>
            </Card>
          ))}
        </TabsContent>

        {/* API */}
        <TabsContent value="api" className="mt-4 space-y-4">
          <Card className="p-5">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="size-4 text-primary" /> API tokens
            </h3>
            <p className="mb-4 text-xs text-muted-foreground">
              For your website, CRM or reporting tools to read and write against the same ledger.
            </p>
            <div className="space-y-2">
              {s.apiTokens.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <Code2 className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{t.tokenPreview}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.scopes.map((sc) => (
                        <Badge key={sc} variant="secondary" className="font-mono text-[9px]">{sc}</Badge>
                      ))}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t.lastUsed ? `Used ${new Date(t.lastUsed).toLocaleDateString('en-IN')}` : 'Never used'}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Webhook className="size-4 text-primary" /> Webhooks
            </h3>
            <p className="mb-4 text-xs text-muted-foreground">
              We call your URL when something happens, so you don&apos;t have to poll us.
            </p>
            <div className="space-y-2">
              {s.webhooks.map((w) => (
                <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-all font-mono text-xs">{w.url}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {w.events.map((e) => (
                        <Badge key={e} variant="secondary" className="font-mono text-[9px]">{e}</Badge>
                      ))}
                    </div>
                  </div>
                  <Badge variant="outline" className={w.isActive ? 'border-emerald-500/40 text-[10px]' : 'text-[10px]'}>
                    {w.isActive ? 'Active' : 'Paused'}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
