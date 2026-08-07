'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Ban, Banknote, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { TotalRow } from '@/components/shared/form-bits';
import { JournalTable } from '@/components/shared/journal-table';
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { billBalance, contactName } from '@/lib/selectors';
import { voidBill } from '@/lib/services/purchases';

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const s = useAppStore();
  const canVoid = usePermission('purchases', 'void');
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');

  const bill = s.bills.find((b) => b.id === id);
  if (!bill) return <Card className="p-8 text-center text-sm text-muted-foreground">Bill not found.</Card>;

  const vendor = s.contacts.find((c) => c.id === bill.vendorId);
  const entry = s.entries.find((e) => e.id === bill.journalEntryId);
  const reversal = s.entries.find((e) => e.isReversalOf === bill.journalEntryId);
  const payments = s.payments.filter((p) =>
    p.allocations.some((a) => a.targetType === 'bill' && a.targetId === bill.id),
  );

  return (
    <>
      <PageHeader
        title={bill.internalNo}
        description={`${contactName(s, bill.vendorId)} · vendor invoice ${bill.number}`}
        actions={
          <>
            <StatusBadge status={bill.status} className="mr-1" />
            {billBalance(bill) > 0 && bill.status !== 'void' && (
              <Button size="sm" asChild className="gap-1.5">
                <Link href={`/purchases/payments/new?bill=${bill.id}`}><Banknote className="size-3.5" /> Pay</Link>
              </Button>
            )}
            {canVoid && bill.status !== 'void' && (
              <Button variant="destructive" size="sm" onClick={() => setVoidOpen(true)} className="gap-1.5">
                <Ban className="size-3.5" /> Void
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Line items</h3>
          <div className="overflow-x-auto rounded-lg border thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Description</th>
                  <th className="px-3 py-2 text-left font-semibold">HSN</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Rate</th>
                  <th className="px-3 py-2 text-left font-semibold">ITC</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{l.description}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.hsnSac || '—'}</td>
                    <td className="px-3 py-2 text-right tabular">{l.qty} {l.uqc}</td>
                    <td className="px-3 py-2 text-right"><Money value={l.ratePaise} /></td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={
                          l.itcEligibility === 'eligible'
                            ? 'border-emerald-500/40 text-[10px]'
                            : 'border-red-500/40 text-[10px]'
                        }
                      >
                        {l.itcEligibility === 'capital_goods' ? 'Capital' : l.itcEligibility === 'eligible' ? 'Eligible' : 'Blocked'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-medium"><Money value={l.totalPaise} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Summary</h3>
          <TotalRow label="Taxable value"><Money value={bill.subtotalPaise} /></TotalRow>
          {bill.tax.cgstPaise > 0 && (
            <>
              <TotalRow label="CGST" muted><Money value={bill.tax.cgstPaise} /></TotalRow>
              <TotalRow label="SGST" muted><Money value={bill.tax.sgstPaise} /></TotalRow>
            </>
          )}
          {bill.tax.igstPaise > 0 && <TotalRow label="IGST" muted><Money value={bill.tax.igstPaise} /></TotalRow>}
          {bill.tdsPaise > 0 && (
            <TotalRow label={`Less: TDS ${bill.tdsSection ?? ''}`} muted>
              −<Money value={bill.tdsPaise} />
            </TotalRow>
          )}
          <TotalRow label="Payable" emphasis><Money value={bill.totalPaise} /></TotalRow>
          {bill.amountPaidPaise > 0 && (
            <>
              <TotalRow label="Paid" muted><Money value={bill.amountPaidPaise} /></TotalRow>
              <TotalRow label="Balance"><Money value={billBalance(bill)} /></TotalRow>
            </>
          )}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {bill.isRcm && <Badge variant="outline" className="border-blue-500/40 text-[10px]">Reverse charge</Badge>}
            {vendor?.isMsme && <Badge variant="outline" className="border-amber-500/40 text-[10px]">MSME vendor</Badge>}
            {vendor?.gstTreatment === 'registered_composition' && (
              <Badge variant="outline" className="border-red-500/40 text-[10px]">Composition — no ITC</Badge>
            )}
          </div>
        </Card>
      </div>

      <Tabs defaultValue="journal">
        <TabsList>
          <TabsTrigger value="journal">Journal entry</TabsTrigger>
          <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="journal" className="mt-4 space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-start gap-2">
              <BookOpen className="mt-0.5 size-4 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">What this bill did to your books</h3>
                <p className="text-xs text-muted-foreground">
                  {bill.isRcm
                    ? 'Reverse charge posts both sides: the tax you owe the government and the credit you reclaim.'
                    : 'Cost and input credit are split, so the GST never inflates your expenses.'}
                </p>
              </div>
            </div>
            {entry ? <JournalTable entryId={entry.id} /> : <p className="text-sm text-muted-foreground">Not posted.</p>}
          </Card>
          {reversal && (
            <Card className="border-destructive/30 p-5">
              <h3 className="mb-3 text-sm font-semibold text-destructive">Reversal entry (void)</h3>
              <JournalTable entryId={reversal.id} />
            </Card>
          )}
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <Card className="p-5">
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments made against this bill yet.</p>
            ) : (
              <div className="divide-y">
                {payments.map((p) => {
                  const alloc = p.allocations.find((a) => a.targetId === bill.id)!;
                  return (
                    <div key={p.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{p.number}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(p.date).toLocaleDateString('en-IN')} · {p.mode.toUpperCase()} · {p.reference}
                        </p>
                      </div>
                      <Money value={alloc.amountPaise} className="text-sm font-medium" />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this bill</DialogTitle>
            <DialogDescription>
              A reversal entry will cancel the original. Nothing is deleted — both stay in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for voiding" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                try {
                  voidBill(bill.id, reason || 'No reason given');
                  toast.success('Bill voided');
                  setVoidOpen(false);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Void bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
