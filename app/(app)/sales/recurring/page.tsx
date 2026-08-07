'use client';

import { useState } from 'react';
import { Bell, Mail, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';

// Recurring profiles and dunning schedules are configuration, not ledger data —
// they're mocked here as UI state to demonstrate the feature surface.
const PROFILES = [
  { id: 'rp1', customerId: 'c_bluehill', desc: 'Monthly fleet maintenance retainer', freq: 'Monthly', next: '2026-09-01', amount: 15000000, mode: 'Auto-send', active: true },
  { id: 'rp2', customerId: 'c_orbit', desc: 'Quarterly parts supply contract', freq: 'Quarterly', next: '2026-10-01', amount: 42500000, mode: 'Save as draft', active: true },
  { id: 'rp3', customerId: 'c_marina', desc: 'AMC — workshop consumables', freq: 'Monthly', next: '2026-09-05', amount: 2800000, mode: 'Auto-send', active: false },
];

const REMINDERS = [
  { id: 'r1', label: '3 days before due', offset: -3, template: 'Friendly reminder', active: true },
  { id: 'r2', label: 'On the due date', offset: 0, template: 'Payment due today', active: true },
  { id: 'r3', label: '7 days overdue', offset: 7, template: 'Overdue — first notice', active: true },
  { id: 'r4', label: '15 days overdue', offset: 15, template: 'Overdue — second notice', active: true },
  { id: 'r5', label: '30 days overdue', offset: 30, template: 'Final notice before escalation', active: false },
];

export default function RecurringPage() {
  const s = useAppStore();
  const [profiles, setProfiles] = useState(PROFILES);
  const [reminders, setReminders] = useState(REMINDERS);

  return (
    <>
      <PageHeader
        title="Recurring & reminders"
        description="Invoices that raise themselves, and reminders that chase payment without you having to."
      />

      <Tabs defaultValue="recurring">
        <TabsList>
          <TabsTrigger value="recurring">Recurring invoices</TabsTrigger>
          <TabsTrigger value="dunning">Payment reminders</TabsTrigger>
        </TabsList>

        <TabsContent value="recurring" className="mt-4 space-y-3">
          {profiles.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{contactName(s, p.customerId)}</p>
                  <Badge variant="secondary" className="text-[10px]">{p.freq}</Badge>
                  <Badge variant="outline" className="text-[10px]">{p.mode}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.desc}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Next run</p>
                <p className="text-sm font-medium">{new Date(p.next).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
              </div>
              <Money value={p.amount} className="w-28 font-medium" />
              <Switch
                checked={p.active}
                onCheckedChange={(v) => {
                  setProfiles((ps) => ps.map((x) => (x.id === p.id ? { ...x, active: v } : x)));
                  toast.info(v ? 'Recurring profile resumed' : 'Recurring profile paused');
                }}
              />
            </Card>
          ))}
          <Card className="flex items-start gap-3 border-dashed p-4">
            <Repeat className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              On each run date the system raises the invoice, applies current GST rates, assigns the next number in the
              series, and either emails it or leaves it as a draft for review — exactly as if you had typed it yourself.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="dunning" className="mt-4 space-y-3">
          {reminders.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center gap-4 p-4">
              <Bell className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.label}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="size-3" /> Template: {r.template}
                </p>
              </div>
              <Switch
                checked={r.active}
                onCheckedChange={(v) => {
                  setReminders((rs) => rs.map((x) => (x.id === r.id ? { ...x, active: v } : x)));
                  toast.info(v ? 'Reminder enabled' : 'Reminder disabled');
                }}
              />
            </Card>
          ))}
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium">Escalation rule</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Notify the owner when an invoice is overdue by</span>
              <Input type="number" defaultValue={30} className="w-20 text-center tabular" />
              <span className="text-muted-foreground">days and the balance exceeds</span>
              <Input defaultValue="25,000" className="w-28 text-center tabular" />
              <Button size="sm" variant="outline" onClick={() => toast.success('Escalation rule saved')}>Save</Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
