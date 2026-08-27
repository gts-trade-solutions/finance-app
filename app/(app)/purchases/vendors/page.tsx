'use client';

import { useState } from 'react';
import { Building2, Plus, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/shared/form-bits';
import { useAppStore, getState, setState } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { billBalance, vendors } from '@/lib/selectors';
import { stateName } from '@/lib/tax/gst';
import { TDS_SECTIONS } from '@/lib/tax/tds';
import { genId } from '@/lib/ledger/posting';
import { Combobox } from '@/components/ui/combobox';
import { stateOptions } from '@/lib/options';
import { logAudit } from '@/lib/services/audit';
import type { Contact, GstTreatment } from '@/lib/types';

export default function VendorsPage() {
  const s = useAppStore();
  const canCreate = usePermission('purchases', 'create');
  const list = vendors(s);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: '', gstin: '', pan: '', stateCode: '33', treatment: 'registered' as GstTreatment,
    tdsSection: '', isMsme: false, udyam: '', terms: 30,
  });

  const outstanding = (v: Contact) =>
    s.bills.filter((b) => b.vendorId === v.id && b.status !== 'void').reduce((t, b) => t + billBalance(b), 0);

  const save = () => {
    if (!f.name.trim()) { toast.error('Vendor name is required'); return; }
    const vendor: Contact = {
      id: genId('v'),
      kind: 'vendor',
      displayName: f.name,
      companyName: f.name,
      gstin: f.gstin || null,
      gstTreatment: f.treatment,
      pan: f.pan || null,
      stateCode: f.stateCode,
      email: '',
      phone: '',
      billingAddress: { label: 'Billing', line1: '', city: '', stateCode: f.stateCode, pincode: '' },
      paymentTermsDays: f.terms,
      creditLimit: null,
      isMsme: f.isMsme,
      udyamNo: f.udyam || undefined,
      tdsSection: f.tdsSection || undefined,
      openingBalance: 0,
      isArchived: false,
    };
    setState({ contacts: [vendor, ...getState().contacts] });
    logAudit('create', 'vendor', vendor.id, vendor.displayName, `Vendor created${f.isMsme ? ' (MSME)' : ''}`);
    toast.success(`${f.name} added`);
    setOpen(false);
  };

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: 'Vendor',
      sortValue: (r) => r.displayName,
      cell: (r) => (
        <div className="flex items-center gap-2">
          <div>
            <p className="font-medium">{r.displayName}</p>
            <p className="text-xs text-muted-foreground">{r.pan ? `PAN ${r.pan}` : 'No PAN — TDS at 20%'}</p>
          </div>
          {r.isMsme && <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-300">MSME</Badge>}
        </div>
      ),
    },
    {
      key: 'gstin',
      header: 'GSTIN',
      sortValue: (r) => r.gstin ?? '',
      cell: (r) =>
        r.gstin ? <span className="font-mono text-xs">{r.gstin}</span>
          : <Badge variant="secondary" className="text-[10px] capitalize">{r.gstTreatment.replace('_', ' ')}</Badge>,
    },
    { key: 'state', header: 'State', sortValue: (r) => stateName(r.stateCode), cell: (r) => stateName(r.stateCode) },
    {
      key: 'itc',
      header: 'ITC',
      sortValue: (r) => r.gstTreatment,
      cell: (r) =>
        r.gstTreatment === 'registered_composition' || r.gstTreatment === 'unregistered' ? (
          <Badge variant="outline" className="gap-1 border-red-500/40 text-[10px] text-red-600 dark:text-red-400">
            <ShieldAlert className="size-2.5" /> No credit
          </Badge>
        ) : (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">Claimable</span>
        ),
    },
    {
      key: 'tds',
      header: 'TDS section',
      sortValue: (r) => r.tdsSection ?? '',
      cell: (r) => (r.tdsSection ? <Badge variant="secondary" className="text-[10px]">{r.tdsSection}</Badge> : <span className="text-xs text-muted-foreground">—</span>),
    },
    {
      key: 'outstanding',
      header: 'Payable',
      align: 'right',
      sortValue: (r) => outstanding(r),
      cell: (r) => <Money value={outstanding(r)} className={outstanding(r) > 0 ? 'font-medium' : 'text-muted-foreground'} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Vendors"
        description="MSME status drives the 45-day payment rule; composition vendors can't pass on input credit."
        actions={
          canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="size-4" /> New vendor</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>New vendor</DialogTitle></DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Vendor name" required className="sm:col-span-2">
                    <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Bosch Automotive Distributors" />
                  </Field>
                  <Field label="GSTIN">
                    <Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} className="font-mono" maxLength={15} />
                  </Field>
                  <Field label="PAN" hint="Without PAN, TDS is deducted at 20%">
                    <Input value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} className="font-mono" maxLength={10} />
                  </Field>
                  <Field label="GST treatment">
                    <Combobox
                      options={[
                        { value: 'registered', label: 'Registered (regular)' },
                        { value: 'registered_composition', label: 'Composition scheme' },
                        { value: 'unregistered', label: 'Unregistered' },
                        { value: 'overseas', label: 'Overseas / import' },
                      ]}
                      value={f.treatment}
                      onChange={(v) => setF({ ...f, treatment: v as GstTreatment })}
                      showAvatar={false}
                      searchPlaceholder="Search treatments"
                    />
                  </Field>
                  <Field label="State">
                    <Combobox
                      options={stateOptions()}
                      value={f.stateCode}
                      onChange={(v) => setF({ ...f, stateCode: v })}
                      placeholder="Select state"
                      searchPlaceholder="Search all 37 states"
                      showAvatar={false}
                    />
                  </Field>
                  <Field label="Default TDS section" hint="Applied automatically once thresholds are crossed" className="sm:col-span-2">
                    <Combobox
                      options={TDS_SECTIONS.map((t) => ({
                        value: t.code,
                        label: `${t.code} — ${t.description}`,
                        sublabel: `${t.ratePctWithPan}% with PAN`,
                      }))}
                      value={f.tdsSection}
                      onChange={(v) => setF({ ...f, tdsSection: v })}
                      placeholder="No TDS"
                      searchPlaceholder="Search sections"
                      showAvatar={false}
                      clearable
                    />
                  </Field>
                  <div className="flex items-start justify-between gap-3 rounded-md border p-3 sm:col-span-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Registered MSME</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Section 43B(h): if you don&apos;t pay within 45 days, the expense is disallowed for income tax.
                      </p>
                    </div>
                    <Switch checked={f.isMsme} onCheckedChange={(v) => setF({ ...f, isMsme: v })} />
                  </div>
                  {f.isMsme && (
                    <Field label="Udyam registration no." className="sm:col-span-2">
                      <Input value={f.udyam} onChange={(e) => setF({ ...f, udyam: e.target.value })} placeholder="UDYAM-TN-02-0012345" />
                    </Field>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save}>Save vendor</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />
      {list.length === 0 ? (
        <EmptyState icon={Building2} title="No vendors" description="Add suppliers to start recording bills." />
      ) : (
        <DataTable rows={list} columns={columns} getRowId={(r) => r.id} searchPlaceholder="Search vendor, GSTIN or PAN…" />
      )}
    </>
  );
}
