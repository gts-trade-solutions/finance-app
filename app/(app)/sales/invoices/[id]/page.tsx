'use client';

// One invoice, from the database.
//
// The Journal tab is the point of this screen. Any package can show a document;
// showing the exact double-entry it produced is what lets an accountant trust
// the rest of the app — and it is the same rows the trial balance is built
// from, not a rendering of what they ought to be.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft, Ban, FileText, Loader2, MoreHorizontal, Printer, Receipt, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { EInvoiceMark } from '@/components/shared/einvoice-mark';
import { ReportTable } from '@/components/shared/report-shell';
import { AsyncPage } from '@/components/shared/async-state';
import { Field } from '@/components/shared/form-bits';
import { usePermission } from '@/lib/store/hooks';
import { invoices as invoiceApi, type InvoiceDetail } from '@/lib/api/client';
import { useApi, useApiAction } from '@/lib/api/use-api';
import { formatINR } from '@/lib/money';

const d = (s: string) =>
  new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const canEdit = usePermission('sales', 'edit');

  const state = useApi<InvoiceDetail>(() => invoiceApi.get(params.id), [params.id]);

  const send = useApiAction(invoiceApi.send);
  const voidIt = useApiAction(invoiceApi.void);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <AsyncPage state={state}>
      {(inv) => {
        const balanced =
          inv.journalLines.reduce((t, l) => t + l.debitPaise, 0) ===
          inv.journalLines.reduce((t, l) => t + l.creditPaise, 0);

        return (
          <>
            <PageHeader
              title={inv.number}
              description={`${inv.customer.name} · raised ${d(inv.date)}, due ${d(inv.dueDate)}`}
              actions={
                <>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/sales/invoices"><ArrowLeft className="mr-1.5 size-3.5" /> Invoices</Link>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
                    <Printer className="size-3.5" /> Print
                  </Button>
                  {canEdit && inv.status !== 'void' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger aria-label="More actions" className="grid size-9 place-items-center rounded-[3px] border transition-colors hover:bg-accent">
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={async () => {
                            if (await send.run(inv.id)) {
                              toast.success(`${inv.number} marked sent`);
                              await state.refetch();
                            } else if (send.error) toast.error(send.error);
                          }}
                        >
                          <Send className="mr-2 size-4" /> Mark as sent
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setVoiding(true)}>
                          <Ban className="mr-2 size-4" /> Void invoice
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              }
            />

            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={inv.status as never} />
              <EInvoiceMark einvoice={{ status: inv.einvoice.status as never, irn: inv.einvoice.irn ?? undefined }} />
              <Badge variant="outline" className="text-[10px] uppercase">
                {inv.supplyType === 'intra' ? 'CGST + SGST' : inv.supplyType === 'inter' ? 'IGST' : inv.supplyType.replace(/_/g, ' ')}
              </Badge>
              <Badge variant="secondary" className="text-[10px] capitalize">{inv.supplyKind}</Badge>
              {inv.balancePaise > 0 && (
                <span className="text-sm text-muted-foreground">
                  <Money value={inv.balancePaise} className="font-medium text-foreground" /> outstanding
                </span>
              )}
            </div>

            <Tabs defaultValue="document">
              <TabsList>
                <TabsTrigger value="document">Document</TabsTrigger>
                <TabsTrigger value="journal">Journal</TabsTrigger>
                <TabsTrigger value="payments">Payments ({inv.payments.length})</TabsTrigger>
              </TabsList>

              {/* ── The invoice itself ─────────────────────────────────── */}
              <TabsContent value="document" className="mt-4 space-y-4">
                <Card className="p-5">
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <p className="micro-label">Billed to</p>
                      <p className="mt-1 font-medium">{inv.customer.name}</p>
                      {inv.customer.address && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{inv.customer.address}</p>
                      )}
                      {inv.customer.gstin && (
                        <p className="mt-1 font-mono text-xs text-muted-foreground">GSTIN {inv.customer.gstin}</p>
                      )}
                    </div>
                    <div className="sm:text-right">
                      <p className="micro-label">Supplied from</p>
                      <p className="mt-1 font-medium">{inv.branch.name}</p>
                      {inv.branch.gstin && (
                        <p className="mt-1 font-mono text-xs text-muted-foreground">GSTIN {inv.branch.gstin}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Place of supply: {inv.placeOfSupply}
                      </p>
                    </div>
                  </div>
                  {inv.subject && <p className="mt-4 border-t pt-4 text-sm">{inv.subject}</p>}
                </Card>

                <Card className="overflow-hidden p-0">
                  <ReportTable>
                    <thead>
                      <tr className="border-b bg-muted/50 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        <th className="px-4 py-2.5 text-left">Item</th>
                        <th className="px-4 py-2.5 text-left">HSN/SAC</th>
                        <th className="px-4 py-2.5 text-right">Qty</th>
                        <th className="px-4 py-2.5 text-right">Rate</th>
                        <th className="px-4 py-2.5 text-right">Taxable</th>
                        <th className="px-4 py-2.5 text-right">GST</th>
                        <th className="px-4 py-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.lines.map((l) => (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="px-4 py-2.5">{l.description ?? '—'}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{l.hsnSac ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular">{l.qty} {l.uqc}</td>
                          <td className="px-4 py-2.5 text-right"><Money value={l.ratePaise} /></td>
                          <td className="px-4 py-2.5 text-right"><Money value={l.taxablePaise} /></td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="text-xs text-muted-foreground">{l.gstRatePct}%</span>{' '}
                            <Money value={l.cgstPaise + l.sgstPaise + l.igstPaise} />
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium"><Money value={l.totalPaise} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </ReportTable>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="p-5">
                    {inv.notes && (
                      <>
                        <p className="micro-label">Notes</p>
                        <p className="mt-1 text-sm text-muted-foreground">{inv.notes}</p>
                      </>
                    )}
                    {inv.terms && (
                      <>
                        <p className="micro-label mt-4">Terms</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{inv.terms}</p>
                      </>
                    )}
                  </Card>

                  <Card className="p-5">
                    <dl className="space-y-2 text-sm">
                      {[
                        ['Taxable value', inv.subtotalPaise],
                        ...(inv.tax.cgstPaise ? [['CGST', inv.tax.cgstPaise] as const] : []),
                        ...(inv.tax.sgstPaise ? [['SGST', inv.tax.sgstPaise] as const] : []),
                        ...(inv.tax.igstPaise ? [['IGST', inv.tax.igstPaise] as const] : []),
                        ...(inv.shippingChargePaise ? [['Shipping', inv.shippingChargePaise] as const] : []),
                        ...(inv.tcsPaise ? [['TCS', inv.tcsPaise] as const] : []),
                        ...(inv.adjustmentPaise ? [[inv.adjustmentLabel ?? 'Adjustment', inv.adjustmentPaise] as const] : []),
                        ...(inv.roundOffPaise ? [['Round off', inv.roundOffPaise] as const] : []),
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex justify-between gap-4">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd><Money value={value as number} /></dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                        <dt>Total</dt>
                        <dd><Money value={inv.totalPaise} /></dd>
                      </div>
                      {inv.amountPaidPaise > 0 && (
                        <>
                          <div className="flex justify-between gap-4">
                            <dt className="text-muted-foreground">Paid</dt>
                            <dd className="text-emerald-600 dark:text-emerald-400">
                              <Money value={inv.amountPaidPaise} />
                            </dd>
                          </div>
                          <div className="flex justify-between gap-4 font-medium">
                            <dt>Balance due</dt>
                            <dd><Money value={inv.balancePaise} /></dd>
                          </div>
                        </>
                      )}
                    </dl>
                  </Card>
                </div>
              </TabsContent>

              {/* ── The double entry behind it ─────────────────────────── */}
              <TabsContent value="journal" className="mt-4 space-y-3">
                {inv.journalEntryId ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Entry {inv.journalEntryId}. These are the rows the trial balance is built from —
                      not a rendering of what they ought to be.
                    </p>
                    <Card className="overflow-hidden p-0">
                      <ReportTable>
                        <thead>
                          <tr className="border-b bg-muted/50 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            <th className="px-4 py-2.5 text-left">Account</th>
                            <th className="px-4 py-2.5 text-left">Description</th>
                            <th className="px-4 py-2.5 text-right">Debit</th>
                            <th className="px-4 py-2.5 text-right">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inv.journalLines.map((l) => (
                            <tr key={l.lineNo} className="border-b last:border-0">
                              <td className="px-4 py-2.5">
                                <span className="font-mono text-xs text-muted-foreground">{l.accountCode}</span>{' '}
                                {l.accountName}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground">{l.description ?? '—'}</td>
                              <td className="px-4 py-2.5 text-right"><Money value={l.debitPaise} showZero={false} /></td>
                              <td className="px-4 py-2.5 text-right"><Money value={l.creditPaise} showZero={false} /></td>
                            </tr>
                          ))}
                          <tr className="border-t-2 bg-muted/40 font-semibold">
                            <td className="px-4 py-3" colSpan={2}>{balanced ? 'Balanced' : 'OUT OF BALANCE'}</td>
                            <td className="px-4 py-3 text-right">
                              {formatINR(inv.journalLines.reduce((t, l) => t + l.debitPaise, 0))}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {formatINR(inv.journalLines.reduce((t, l) => t + l.creditPaise, 0))}
                            </td>
                          </tr>
                        </tbody>
                      </ReportTable>
                    </Card>
                  </>
                ) : (
                  <Card className="flex items-start gap-3 p-5">
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Nothing has been posted. A draft is a document somebody is still writing, not a sale
                      that has happened — putting it in the ledger would overstate revenue and the GST that
                      follows from it.
                    </p>
                  </Card>
                )}
              </TabsContent>

              {/* ── Receipts against it ────────────────────────────────── */}
              <TabsContent value="payments" className="mt-4">
                {inv.payments.length === 0 ? (
                  <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                    <Receipt className="size-4" /> Nothing received against this invoice yet.
                  </Card>
                ) : (
                  <Card className="overflow-hidden p-0">
                    <div className="divide-y">
                      {inv.payments.map((p) => (
                        <div key={p.id} className="flex items-center gap-4 p-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{p.number}</p>
                            <p className="text-xs text-muted-foreground">
                              {d(p.date)} · <span className="uppercase">{p.mode}</span>
                            </p>
                          </div>
                          <Money value={p.amountPaise} className="font-medium" />
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </TabsContent>
            </Tabs>

            <Dialog open={voiding} onOpenChange={setVoiding}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Void {inv.number}?</DialogTitle>
                  <DialogDescription>
                    The invoice stays in the books and its journal entry is reversed rather than removed.
                    GST requires the number to remain accounted for — a gap in the series is a question at
                    assessment.
                  </DialogDescription>
                </DialogHeader>
                <Field label="Reason" hint="Recorded in the audit trail">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Raised in error" />
                </Field>
                {voidIt.error && <p className="text-sm text-destructive">{voidIt.error}</p>}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setVoiding(false)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    disabled={voidIt.busy}
                    onClick={async () => {
                      const ok = await voidIt.run(inv.id, reason || undefined);
                      if (ok) {
                        toast.success(`${inv.number} voided`, {
                          description: 'A reversing entry has been posted.',
                        });
                        setVoiding(false);
                        await state.refetch();
                      }
                    }}
                    className="gap-1.5"
                  >
                    {voidIt.busy && <Loader2 className="size-3.5 animate-spin" />} Void invoice
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        );
      }}
    </AsyncPage>
  );
}
