'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { Field, FormSection, MoneyInput } from '@/components/shared/form-bits';
import { getState, setState } from '@/lib/store';
import { GST_STATES, isValidGstin } from '@/lib/tax/gst';
import { genId } from '@/lib/ledger/posting';
import { logAudit } from '@/lib/services/audit';
import type { Contact, GstTreatment } from '@/lib/types';

export default function NewCustomerPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [treatment, setTreatment] = useState<GstTreatment>('registered');
  const [stateCode, setStateCode] = useState('33');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [terms, setTerms] = useState(30);
  const [creditLimit, setCreditLimit] = useState(0);
  const [deductsTds, setDeductsTds] = useState(false);

  const gstinValid = gstin.length === 15 ? isValidGstin(gstin.toUpperCase()) : null;

  const save = () => {
    if (!name.trim()) {
      toast.error('Customer name is required');
      return;
    }
    if (gstin && gstinValid === false) {
      toast.error('That GSTIN fails the checksum — please re-check it');
      return;
    }
    const contact: Contact = {
      id: genId('c'),
      kind: 'customer',
      displayName: name,
      companyName: name,
      gstin: gstin ? gstin.toUpperCase() : null,
      gstTreatment: treatment,
      pan: gstin ? gstin.slice(2, 12) : null,
      stateCode,
      email,
      phone,
      billingAddress: { label: 'Billing', line1, city, stateCode, pincode },
      paymentTermsDays: terms,
      creditLimit: creditLimit || null,
      isMsme: false,
      customerDeductsTds: deductsTds,
      openingBalance: 0,
      portalEnabled: true,
      isArchived: false,
    };
    setState({ contacts: [contact, ...getState().contacts] });
    logAudit('create', 'customer', contact.id, contact.displayName, `Customer created (${GST_STATES[stateCode]})`);
    toast.success(`${name} added`);
    router.push('/sales/customers');
  };

  return (
    <>
      <PageHeader
        title="New customer"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.back()}>Cancel</Button>
            <Button size="sm" onClick={save}>Save customer</Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-6 p-5 lg:col-span-2">
          <FormSection title="Basic details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer name" required className="sm:col-span-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sharma Traders" />
              </Field>
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="accounts@example.in" />
              </Field>
              <Field label="Phone">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98400 12345" />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Tax details" description="These drive how GST is calculated on every invoice.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="GST treatment" required>
                <Select value={treatment} onValueChange={(v) => setTreatment(v as GstTreatment)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="registered">Registered business (regular)</SelectItem>
                    <SelectItem value="registered_composition">Registered — composition</SelectItem>
                    <SelectItem value="unregistered">Unregistered / B2C</SelectItem>
                    <SelectItem value="overseas">Overseas — export</SelectItem>
                    <SelectItem value="sez">SEZ unit</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="GSTIN"
                hint={
                  gstinValid === true ? undefined :
                  gstinValid === false ? undefined :
                  'Checksum is verified as you type'
                }
                error={gstinValid === false ? 'Invalid GSTIN — checksum does not match' : undefined}
              >
                <div className="relative">
                  <Input
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="33ABCDE1234F1Z5"
                    maxLength={15}
                    className="pr-9 font-mono"
                  />
                  {gstinValid !== null && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      {gstinValid ? (
                        <Check className="size-4 text-emerald-600" />
                      ) : (
                        <X className="size-4 text-destructive" />
                      )}
                    </span>
                  )}
                </div>
              </Field>
              <Field label="State" required hint="Decides intra-state vs inter-state tax" className="sm:col-span-2">
                <Select value={stateCode} onValueChange={setStateCode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(GST_STATES).map(([code, n]) => (
                      <SelectItem key={code} value={code}>{code} — {n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FormSection>

          <FormSection title="Billing address">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Address" className="sm:col-span-3">
                <Input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="12 Mount Road" />
              </Field>
              <Field label="City" className="sm:col-span-2">
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Chennai" />
              </Field>
              <Field label="PIN code">
                <Input value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="600002" />
              </Field>
            </div>
          </FormSection>
        </Card>

        <Card className="space-y-6 p-5">
          <FormSection title="Terms & credit">
            <Field label="Payment terms (days)" hint="Used to calculate invoice due dates">
              <Input type="number" value={terms} onChange={(e) => setTerms(Number(e.target.value))} />
            </Field>
            <Field label="Credit limit" hint="Warns when outstanding exceeds this">
              <MoneyInput valuePaise={creditLimit} onChangePaise={setCreditLimit} />
            </Field>
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Deducts TDS on our invoices</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Large customers withhold tax and pay you net. We&apos;ll track it as TDS Receivable.
                </p>
              </div>
              <Switch checked={deductsTds} onCheckedChange={setDeductsTds} />
            </div>
          </FormSection>
        </Card>
      </div>
    </>
  );
}
