'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  Ban, BookOpen, FileCheck2, Loader2, Printer, Send, Truck, Wallet,
} from 'lucide-react';
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
import { useAppStore } from '@/lib/store';
import { usePermission } from '@/lib/store/hooks';
import { contactName, effectiveInvoiceStatus, invoiceBalance } from '@/lib/selectors';
import { markInvoiceSent, voidInvoice } from '@/lib/services/sales';
import { submitToIrp, generateEwayBill } from '@/lib/mock/simulators';
import { supplyTypeLabel } from '@/lib/tax/gst';
import { InvoicePrintSheet } from '@/components/print/invoice-sheet';
import { JournalTable } from '@/components/shared/journal-table';
import { EInvoiceMark } from '@/components/shared/einvoice-mark';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const s = useAppStore();
  const canEdit = usePermission('sales', 'edit');
  const canVoid = usePermission('sales', 'void');

  const [irpBusy, setIrpBusy] = useState(false);
  const [ewbOpen, setEwbOpen] = useState(false);
  const [ewbBusy, setEwbBusy] = useState(false);
  const [vehicle, setVehicle] = useState('TN09 AB 1234');
  const [distance, setDistance] = useState('120');
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const inv = s.invoices.find((i) => i.id === id);
  if (!inv) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Invoice not found. <Link href="/sales/invoices" className="text-primary underline">Back to invoices</Link>
      </Card>
    );
  }

  const entry = s.entries.find((e) => e.id === inv.journalEntryId);
  const reversal = s.entries.find((e) => e.isReversalOf === inv.journalEntryId);
  const payments = s.payments.filter((p) =>
    p.allocations.some((a) => a.targetType === 'invoice' && a.targetId === inv.id),
  );
  const ewb = s.ewayBills.find((e) => e.invoiceId === inv.id);

  const runIrp = async () => {
    setIrpBusy(true);
    const res = await submitToIrp(inv.id);
    setIrpBusy(false);
    if (res.ok) {
      toast.success('IRN generated', { description: 'Signed QR code stamped on the invoice.' });
    } else {
      toast.error('IRP rejected the invoice', { description: res.error });
    }
  };

  const runEwb = async () => {
    setEwbBusy(true);
    await generateEwayBill({
      invoiceId: inv.id,
      vehicleNo: vehicle,
      distanceKm: Number(distance) || 100,
    });
    setEwbBusy(false);
    setEwbOpen(false);
    toast.success('E-way bill generated');
  };

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={inv.number}
          description={`${contactName(s, inv.customerId)} · ${supplyTypeLabel(inv.supplyType)}`}
          actions={
            <>
              <EInvoiceMark einvoice={inv.einvoice} withLabel className="mr-1" />
              <StatusBadge status={effectiveInvoiceStatus(inv)} className="mr-1" />
              <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
                <Printer className="size-3.5" /> Print / PDF
              </Button>
              {canEdit && inv.status === 'approved' && (
                <Button variant="outline" size="sm" onClick={() => { markInvoiceSent(inv.id); toast.success('Invoice emailed to customer'); }} className="gap-1.5">
                  <Send className="size-3.5" /> Send
                </Button>
              )}
              {canEdit && invoiceBalance(inv) > 0 && inv.status !== 'void' && (
                <Button size="sm" asChild className="gap-1.5">
                  <Link href={`/sales/payments/new?invoice=${inv.id}`}>
                    <Wallet className="size-3.5" /> Record payment
                  </Link>
                </Button>
              )}
              {canVoid && inv.status !== 'void' && (
                <Button variant="destructive" size="sm" onClick={() => setVoidOpen(true)} className="gap-1.5">
                  <Ban className="size-3.5" /> Void
                </Button>
              )}
            </>
          }
        />
      </div>

      {/* Compliance strip */}
      {inv.einvoice.status !== 'not_applicable' && (
        <Card className="no-print flex flex-wrap items-center gap-3 p-4">
          <FileCheck2 className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            {inv.einvoice.status === 'submitted' ? (
              <>
                <p className="text-sm font-medium">E-invoice registered</p>
                <p className="break-all font-mono text-[11px] text-muted-foreground">IRN {inv.einvoice.irn}</p>
              </>
            ) : inv.einvoice.status === 'failed' ? (
              <>
                <p className="text-sm font-medium text-destructive">IRP rejected this invoice</p>
                <p className="text-xs text-muted-foreground">{inv.einvoice.error}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Awaiting IRN</p>
                <p className="text-xs text-muted-foreground">
                  B2B invoices are not legally valid until the IRP issues an IRN. Report within 30 days.
                </p>
              </>
            )}
          </div>
          {inv.einvoice.status !== 'submitted' && (
            <Button size="sm" onClick={runIrp} disabled={irpBusy} className="gap-1.5">
              {irpBusy ? <Loader2 className="size-3.5 animate-spin" /> : <FileCheck2 className="size-3.5" />}
              {irpBusy ? 'Submitting to IRP…' : inv.einvoice.status === 'failed' ? 'Retry' : 'Submit to IRP'}
            </Button>
          )}
          {inv.einvoice.status === 'submitted' && !ewb && (
            <Button variant="outline" size="sm" onClick={() => setEwbOpen(true)} className="gap-1.5">
              <Truck className="size-3.5" /> Generate e-way bill
            </Button>
          )}
          {ewb && (
            <Badge variant="outline" className="gap-1.5">
              <Truck className="size-3" /> EWB {ewb.ewbNo} · valid to {ewb.validUntil}
            </Badge>
          )}
        </Card>
      )}

      <Tabs defaultValue="document" className="no-print">
        <TabsList>
          <TabsTrigger value="document">Document</TabsTrigger>
          <TabsTrigger value="journal">Journal entry</TabsTrigger>
          <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="document" className="mt-4">
          <Card className="p-0">
            <InvoicePrintSheet invoiceId={inv.id} />
          </Card>
        </TabsContent>

        <TabsContent value="journal" className="mt-4 space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">What this invoice did to your books</h3>
                <p className="text-xs text-muted-foreground">
                  Every rupee is accounted for twice — what we gained, and where it came from. The two columns must match.
                </p>
              </div>
            </div>
            {entry ? (
              <JournalTable entryId={entry.id} />
            ) : (
              <p className="text-sm text-muted-foreground">This invoice is still a draft — nothing posted yet.</p>
            )}
          </Card>
          {reversal && (
            <Card className="border-destructive/30 p-5">
              <h3 className="mb-3 text-sm font-semibold text-destructive">Reversal entry (void)</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                The original entry above is never deleted. This opposite entry cancels it, so the audit trail shows both what happened and that it was reversed.
              </p>
              <JournalTable entryId={reversal.id} />
            </Card>
          )}
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <Card className="p-5">
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments received against this invoice yet.</p>
            ) : (
              <div className="divide-y">
                {payments.map((p) => {
                  const alloc = p.allocations.find((a) => a.targetId === inv.id)!;
                  return (
                    <div key={p.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{p.number}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(p.date).toLocaleDateString('en-IN')} · {p.mode.toUpperCase()}
                          {p.tdsPaise > 0 && ` · TDS ₹${(p.tdsPaise / 100).toLocaleString('en-IN')} deducted`}
                        </p>
                      </div>
                      <Money value={alloc.amountPaise} className="text-sm font-medium" />
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-3 text-sm font-semibold">
                  <span>Balance due</span>
                  <Money value={invoiceBalance(inv)} />
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Print-only clean sheet */}
      <div className="print-only">
        <InvoicePrintSheet invoiceId={inv.id} />
      </div>

      {/* E-way bill dialog */}
      <Dialog open={ewbOpen} onOpenChange={setEwbOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate e-way bill</DialogTitle>
            <DialogDescription>
              Required for moving goods above ₹50,000. Validity is one day per 200 km.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Vehicle number</label>
              <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Approx. distance (km)</label>
              <Input type="number" value={distance} onChange={(e) => setDistance(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEwbOpen(false)}>Cancel</Button>
            <Button onClick={runEwb} disabled={ewbBusy} className="gap-1.5">
              {ewbBusy && <Loader2 className="size-3.5 animate-spin" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void dialog */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this invoice</DialogTitle>
            <DialogDescription>
              Nothing is deleted. A reversal entry cancels the original, and both stay visible in the audit trail — this is what the law requires.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Reason</label>
            <Input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Raised in error — duplicate of INV/26-27/0031"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                try {
                  voidInvoice(inv.id, voidReason || 'No reason given');
                  toast.success('Invoice voided', { description: 'Reversal entry posted. Original retained.' });
                  setVoidOpen(false);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Void invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
