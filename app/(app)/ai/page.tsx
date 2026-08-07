'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, Bot, Check, Loader2, ScanLine, Send, ShieldAlert, Sparkles, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { useAppStore } from '@/lib/store';
import {
  askAssistant, detectAnomalies, extractDocument, type AnomalyFlag, type ExtractedBill,
} from '@/lib/mock/simulators';
import { createBill } from '@/lib/services/purchases';
import { toPaise } from '@/lib/money';

const SUGGESTED = [
  'Which invoices are overdue?',
  'Who are my top customers?',
  'What is my GST liability?',
  'How much cash do I have?',
];

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  rows?: { label: string; value: string }[];
}

export default function AiPage() {
  const s = useAppStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      text: 'Ask me anything about your books. I read the same ledger the reports do, so my answers always match what you see elsewhere.',
    },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedBill | null>(null);

  const [flags, setFlags] = useState<AnomalyFlag[]>([]);
  useEffect(() => setFlags(detectAnomalies()), [s]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setThinking(true);
    const res = await askAssistant(q);
    setThinking(false);
    setMessages((m) => [...m, { role: 'assistant', text: res.answer, rows: res.rows }]);
  };

  const scan = async (fileName: string) => {
    setScanning(true);
    setExtracted(null);
    const res = await extractDocument(fileName);
    setScanning(false);
    setExtracted(res);
  };

  const approveExtracted = () => {
    if (!extracted) return;
    const bill = createBill({
      branchId: s.activeBranchId,
      vendorId: extracted.vendorId!,
      vendorInvoiceNo: extracted.invoiceNo,
      date: extracted.date,
      dueDate: extracted.date,
      lines: extracted.lines.map((l) => ({
        itemId: null,
        description: l.description,
        qty: l.qty,
        ratePaise: toPaise(l.rate),
        gstRatePct: l.gstRatePct,
      })),
    });
    toast.success(`Bill ${bill.internalNo} created from the scanned document`);
    setExtracted(null);
  };

  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Three jobs it does well: reading documents, answering questions about your books, and noticing things you'd rather catch early."
      />

      <Tabs defaultValue="ask">
        <TabsList>
          <TabsTrigger value="ask">Ask a question</TabsTrigger>
          <TabsTrigger value="scan">Scan a document</TabsTrigger>
          <TabsTrigger value="flags">
            What needs attention {flags.length > 0 && `(${flags.length})`}
          </TabsTrigger>
        </TabsList>

        {/* ── Ask ─────────────────────────────────────────────────────────── */}
        <TabsContent value="ask" className="mt-4">
          <Card className="flex h-[520px] flex-col p-0">
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5 thin-scroll">
              {messages.map((m, i) => (
                <div key={i} className={'flex gap-3 ' + (m.role === 'user' ? 'justify-end' : '')}>
                  {m.role === 'assistant' && (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="size-3.5 text-primary" />
                    </div>
                  )}
                  <div className={'max-w-lg space-y-2 ' + (m.role === 'user' ? 'order-first' : '')}>
                    <div
                      className={
                        'rounded-lg px-3.5 py-2.5 text-sm ' +
                        (m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted')
                      }
                    >
                      {m.text}
                    </div>
                    {m.rows && (
                      <div className="overflow-hidden rounded-lg border">
                        {m.rows.map((r, j) => (
                          <div key={j} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-xs last:border-0">
                            <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
                            <span className="shrink-0 font-medium tabular">{r.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex gap-3">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="size-3.5 text-primary" />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Reading your ledger…
                  </div>
                </div>
              )}
            </div>

            <div className="border-t p-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SUGGESTED.map((q) => (
                  <Button key={q} variant="outline" size="xs" onClick={() => ask(q)} disabled={thinking}>
                    {q}
                  </Button>
                ))}
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); ask(input); }}
                className="flex gap-2"
              >
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about receivables, sales, GST or cash…"
                  disabled={thinking}
                />
                <Button type="submit" size="icon" disabled={thinking || !input.trim()}>
                  <Send className="size-4" />
                </Button>
              </form>
            </div>
          </Card>
        </TabsContent>

        {/* ── Scan ────────────────────────────────────────────────────────── */}
        <TabsContent value="scan" className="mt-4 space-y-4">
          <Card className="p-5">
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) scan(f.name); }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors hover:border-primary/50 hover:bg-accent/40"
            >
              {scanning ? (
                <>
                  <Loader2 className="mb-3 size-7 animate-spin text-primary" />
                  <p className="text-sm font-medium">Reading the document…</p>
                  <p className="mt-1 text-xs text-muted-foreground">Extracting vendor, invoice number, line items and tax</p>
                </>
              ) : (
                <>
                  <ScanLine className="mb-3 size-7 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop a bill or receipt here</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Photo or PDF · we read it, you check it, then it becomes a bill
                  </p>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/*,.pdf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) scan(f.name); e.target.value = ''; }}
            />
            {!scanning && !extracted && (
              <Button variant="outline" size="sm" onClick={() => scan('vendor-invoice-sample.pdf')} className="mt-3 gap-1.5">
                <Sparkles className="size-3.5" /> Try it with a sample document
              </Button>
            )}
          </Card>

          {extracted && (
            <Card className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Here&apos;s what I read</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Check it before approving — nothing is posted until you say so.
                  </p>
                </div>
                <Badge variant="outline" className="border-emerald-500/40">
                  {Math.round(extracted.confidence * 100)}% confidence
                </Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Vendor</p>
                  <p className="mt-0.5 text-sm font-medium">{extracted.vendorGuess}</p>
                  <Badge variant="secondary" className="mt-1 text-[9px]">Matched to existing vendor</Badge>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Invoice number</p>
                  <p className="mt-0.5 text-sm font-medium">{extracted.invoiceNo}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="mt-0.5 text-sm font-medium">{new Date(extracted.date).toLocaleDateString('en-IN')}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border thin-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-left font-semibold">Description</th>
                      <th className="px-3 py-2 text-right font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Rate</th>
                      <th className="px-3 py-2 text-right font-semibold">GST</th>
                      <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extracted.lines.map((l, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2">{l.description}</td>
                        <td className="px-3 py-2 text-right tabular">{l.qty}</td>
                        <td className="px-3 py-2 text-right"><Money value={toPaise(l.rate)} /></td>
                        <td className="px-3 py-2 text-right tabular">{l.gstRatePct}%</td>
                        <td className="px-3 py-2 text-right font-medium"><Money value={toPaise(l.qty * l.rate)} /></td>
                      </tr>
                    ))}
                    <tr className="bg-muted/40 font-semibold">
                      <td className="px-3 py-2" colSpan={4}>Total</td>
                      <td className="px-3 py-2 text-right"><Money value={toPaise(extracted.totalRupees)} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {extracted.warnings.length > 0 && (
                <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  {extracted.warnings.map((w, i) => (
                    <p key={i} className="text-[11px] leading-relaxed text-muted-foreground">• {w}</p>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={approveExtracted} className="gap-1.5">
                  <Check className="size-4" /> Approve &amp; create bill
                </Button>
                <Button variant="outline" onClick={() => setExtracted(null)} className="gap-1.5">
                  <X className="size-4" /> Discard
                </Button>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ── Flags ───────────────────────────────────────────────────────── */}
        <TabsContent value="flags" className="mt-4 space-y-3">
          <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              These aren&apos;t canned warnings — each one comes from checking your actual records: duplicate vendor
              bills, MSME payment deadlines, input credit your suppliers haven&apos;t filed for, customers over their
              limit, and invoices missing an IRN.
            </p>
          </Card>

          {flags.length === 0 ? (
            <Card className="p-10 text-center">
              <Check className="mx-auto mb-3 size-8 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-medium">Nothing needs your attention</p>
              <p className="mt-1 text-xs text-muted-foreground">Every check passed against the current books.</p>
            </Card>
          ) : (
            flags.map((f) => (
              <Card key={f.id} className="flex flex-wrap items-start gap-4 p-4">
                <span
                  className={
                    'mt-1.5 size-2 shrink-0 rounded-full ' +
                    (f.severity === 'high' ? 'bg-red-500' : f.severity === 'medium' ? 'bg-amber-500' : 'bg-muted-foreground')
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{f.title}</p>
                    <Badge variant="outline" className="text-[9px] capitalize">{f.severity}</Badge>
                    <Badge variant="secondary" className="text-[9px]">{f.entityLabel}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.detail}</p>
                </div>
                <Button variant="outline" size="sm" asChild className="gap-1">
                  <Link
                    href={
                      f.id.startsWith('msme') ? '/purchases/msme-tracker'
                        : f.id.startsWith('itc') || f.id.startsWith('book') ? '/gst/itc-reconciliation'
                          : f.id.startsWith('einv') ? '/gst/einvoices'
                            : f.id.startsWith('credit') ? '/sales/customers'
                              : '/purchases/bills'
                    }
                  >
                    {f.action} <ArrowRight className="size-3" />
                  </Link>
                </Button>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
