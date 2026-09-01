'use client';

// Settings — the organisation, its branches, its people, and its numbering.
//
// Numbering is shown, never edited. A series is advanced by the database as
// documents are raised; letting somebody set the next number by hand is how a
// book ends up with two invoices sharing a number, which is a question at
// assessment rather than a display problem.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Plug, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { Field } from '@/components/shared/form-bits';
import { AsyncPage } from '@/components/shared/async-state';
import { api } from '@/lib/api/client';
import { useApi, useApiAction } from '@/lib/api/use-api';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { stateName } from '@/lib/tax/gst';

interface SettingsResponse {
  org: {
    id: string; name: string; legalName: string | null; pan: string | null;
    email: string | null; phone: string | null; address: string | null;
    fiscalYearStartMonth: number; currency: string;
    gstRegistrationType: string; einvoiceApplicable: boolean;
  };
  branches: {
    id: string; name: string; gstin: string | null; stateCode: string;
    address: string | null; isPrimary: boolean; isActive: boolean;
  }[];
  users: {
    id: string; name: string; email: string; role: string;
    branchName: string | null; isActive: boolean; lastLoginAt: string | null;
  }[];
  series: { scope: string; docType: string; fyLabel: string; branchName: string | null; nextValue: number }[];
  counts: { contacts: number; items: number; invoices: number; journalEntries: number };
}

const ROLE_MATRIX = [
  { role: 'Admin', scope: 'Everything, including settings, period locks and voiding documents.' },
  { role: 'Accountant', scope: 'Full books, banking, GST and journals. Cannot change org settings.' },
  { role: 'Sales', scope: 'Quotes, invoices and customers. Purchase costs and profit are hidden.' },
  { role: 'Staff', scope: 'Create documents only — no approvals, no reports.' },
  { role: 'Viewer', scope: 'Read-only across the app. For auditors and stakeholders.' },
];

/**
 * Things the screens exist for but the backend does not do yet. Listed plainly
 * rather than shown as switches that quietly save nothing — a settings page
 * that lies about what is connected is worse than one that admits the gap.
 */
const NOT_BUILT = [
  {
    name: 'GST Suvidha Provider',
    desc: 'E-invoice IRNs, e-way bills and GSTR-2B downloads run through a licensed GSP.',
    why: 'Needs a GSP contract and production credentials. The rules around it are implemented; the call is not.',
  },
  {
    name: 'Account Aggregator bank feeds',
    desc: 'Daily transaction sync straight from your banks.',
    why: 'Pulling from the AA framework needs a Financial Information User licence, which means being regulated by the RBI, SEBI, IRDAI or PFRDA. Statement upload is the honest route until a licensed partner is in place.',
  },
  {
    name: 'Email delivery',
    desc: 'Sending invoices and payment reminders.',
    why: 'No mail transport is wired up, so reminder schedules are configuration for something that does not run yet.',
  },
  {
    name: 'Payment links',
    desc: 'A pay-now button on the invoice, and settlement reconciliation.',
    why: 'Needs a payment gateway account and a webhook endpoint.',
  },
  {
    name: 'Custom fields, workflows and approvals',
    desc: 'Extra fields per document type, and rules that act on their own.',
    why: 'The tables exist; nothing reads or writes them yet.',
  },
  {
    name: 'Developer API',
    desc: 'Tokens and webhooks for your website or CRM.',
    why: 'The api_tokens table is in place but no token is issued or accepted.',
  },
];

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function SettingsPage() {
  const canEdit = usePermission('settings', 'edit');
  const currentUserId = useAppStore((s) => s.session?.userId);
  const state = useApi<SettingsResponse>(() => api.get('/api/settings'), []);

  const [form, setForm] = useState({ name: '', legalName: '', pan: '', email: '', phone: '', address: '' });
  const save = useApiAction((input: unknown) => api.patch<{ id: string }>('/api/settings', input));

  useEffect(() => {
    const o = state.data?.org;
    if (!o) return;
    setForm({
      name: o.name,
      legalName: o.legalName ?? '',
      pan: o.pan ?? '',
      email: o.email ?? '',
      phone: o.phone ?? '',
      address: o.address ?? '',
    });
  }, [state.data]);

  const submit = async () => {
    const done = await save.run({
      name: form.name,
      legalName: form.legalName || null,
      pan: form.pan || null,
      email: form.email || null,
      phone: form.phone || null,
      address: form.address || null,
    });
    if (!done) {
      toast.error(save.error ?? 'The changes were not saved');
      return;
    }
    toast.success('Organisation settings saved');
    state.refetch();
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organisation, users, numbering, and what is and is not connected."
      />

      <AsyncPage state={state}>
        {(d) => (
          <Tabs defaultValue="org">
            <TabsList className="flex-wrap">
              <TabsTrigger value="org">Organisation</TabsTrigger>
              <TabsTrigger value="users">Users &amp; roles</TabsTrigger>
              <TabsTrigger value="numbering">Numbering</TabsTrigger>
              <TabsTrigger value="integrations">Not built yet</TabsTrigger>
            </TabsList>

            {/* Organisation */}
            <TabsContent value="org" className="mt-4 space-y-4">
              <Card className="space-y-5 p-5">
                <h3 className="text-sm font-semibold">Organisation details</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Business name" required error={save.fieldErrors.name}>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field label="Legal name" hint="As registered, if it differs">
                    <Input
                      value={form.legalName}
                      onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field label="PAN" error={save.fieldErrors.pan}>
                    <Input
                      value={form.pan}
                      onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                      className="font-mono"
                      maxLength={10}
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field label="Email" error={save.fieldErrors.email}>
                    <Input
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field label="Address">
                    <Input
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field
                    label="Financial year"
                    hint="Fixed once the books are open — every posted entry and every number series was produced under it"
                    className="sm:col-span-2"
                  >
                    <Input
                      value={`Starts ${MONTHS[d.org.fiscalYearStartMonth]} · ${d.org.currency} · ${d.org.gstRegistrationType} scheme`}
                      readOnly
                      className="bg-muted/40"
                    />
                  </Field>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Turnover above ₹5 crore</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Makes e-invoicing mandatory — B2B invoices must be registered with the IRP within 30 days.
                    </p>
                  </div>
                  <Badge variant="outline" className={d.org.einvoiceApplicable ? 'border-emerald-500/40' : ''}>
                    {d.org.einvoiceApplicable ? 'Applicable' : 'Not applicable'}
                  </Badge>
                </div>
                {canEdit && (
                  <Button size="sm" onClick={submit} disabled={save.busy}>
                    {save.busy ? 'Saving…' : 'Save changes'}
                  </Button>
                )}
              </Card>

              <Card className="p-5">
                <h3 className="mb-3 text-sm font-semibold">Branches &amp; GST registrations</h3>
                <div className="space-y-2">
                  {d.branches.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{b.name}</p>
                          {b.isPrimary && <Badge variant="secondary" className="text-[9px]">Primary</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {b.address ?? stateName(b.stateCode)}
                        </p>
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px]">{b.gstin ?? 'No GSTIN'}</Badge>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Each state you operate in needs its own GST registration, and each registration keeps its own
                  invoice number series. That&apos;s why branches sit at the heart of the app rather than being an
                  afterthought.
                </p>
              </Card>

              <Card className="flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">HSN &amp; SAC codes</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    The approved code list your team may pick from on invoice lines. Nothing outside it can be
                    entered — the server rejects it — which is what keeps GSTR-1 from bouncing on an invalid code.
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/settings/hsn-codes">Manage codes</Link>
                </Button>
              </Card>

              <Card className="p-5">
                <h3 className="mb-3 text-sm font-semibold">What this book holds</h3>
                <div className="grid gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Contacts', value: d.counts.contacts },
                    { label: 'Items', value: d.counts.items },
                    { label: 'Invoices', value: d.counts.invoices },
                    { label: 'Journal entries', value: d.counts.journalEntries },
                  ].map((c) => (
                    <div key={c.label} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                      <p className="mt-1 text-xl font-semibold tabular">{c.value}</p>
                    </div>
                  ))}
                </div>
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
                  <Badge variant="outline" className="border-emerald-500/40 text-[10px]">
                    {d.users.filter((u) => u.isActive).length} active
                  </Badge>
                </div>
                <div className="space-y-2">
                  {d.users.map((u) => (
                    <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {u.email}
                          {u.branchName ? ` · ${u.branchName}` : ''}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {u.lastLoginAt
                          ? `Last in ${new Date(u.lastLoginAt).toLocaleDateString('en-IN')}`
                          : 'Never signed in'}
                      </span>
                      <Badge variant="secondary" className="capitalize">{u.role}</Badge>
                      {u.id === currentUserId && <Badge variant="outline" className="text-[9px]">You</Badge>}
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
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  The same matrix is checked on the server for every request. Hiding a button is a courtesy; the
                  API refusing the call is the control.
                </p>
              </Card>
            </TabsContent>

            {/* Numbering */}
            <TabsContent value="numbering" className="mt-4">
              <Card className="p-5">
                <h3 className="mb-1 text-sm font-semibold">Document numbering</h3>
                <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                  GST law requires invoice numbers to run consecutively without gaps, stay within 16 characters, and
                  use only letters, digits, hyphens and slashes. Each branch and financial year keeps its own
                  sequence, held in the database — so two people raising an invoice at the same moment cannot get
                  the same number.
                </p>
                <div className="overflow-x-auto rounded-lg border thin-scroll">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 text-left font-semibold">Document</th>
                        <th className="px-3 py-2 text-left font-semibold">Branch</th>
                        <th className="px-3 py-2 text-left font-semibold">Financial year</th>
                        <th className="px-3 py-2 text-left font-semibold">Next number</th>
                        <th className="px-3 py-2 text-right font-semibold">Issued so far</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.series.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                            No numbers have been issued yet.
                          </td>
                        </tr>
                      ) : (
                        d.series.map((s) => (
                          <tr key={s.scope} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <Badge variant="secondary" className="text-[10px]">{s.docType}</Badge>
                            </td>
                            <td className="px-3 py-2">{s.branchName ?? 'All branches'}</td>
                            <td className="px-3 py-2 text-xs">{s.fyLabel}</td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {s.docType}/{s.fyLabel}/{String(s.nextValue).padStart(4, '0')}
                            </td>
                            <td className="px-3 py-2 text-right tabular">{s.nextValue - 1}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  These are read-only on purpose. Setting the next number by hand is how a book ends up with two
                  documents sharing one — which is a question at assessment, not a display problem.
                </p>
              </Card>
            </TabsContent>

            {/* Honest gaps */}
            <TabsContent value="integrations" className="mt-4 space-y-3">
              <Card className="flex items-start gap-3 border-amber-500/30 bg-amber-500/5 p-4">
                <Plug className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Everything below has a screen in the app but no working connection behind it. They are listed here
                  rather than shown as switches that quietly save nothing — a settings page that claims to be
                  connected when it is not is worse than one that admits the gap.
                </p>
              </Card>

              {NOT_BUILT.map((i) => (
                <Card key={i.name} className="flex flex-wrap items-start gap-3 p-4">
                  <div className="rounded-lg bg-muted p-2">
                    <Plug className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{i.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{i.desc}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Why not yet:</span> {i.why}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">Not connected</Badge>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        )}
      </AsyncPage>
    </>
  );
}
