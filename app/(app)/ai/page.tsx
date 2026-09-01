'use client';

// The assistant.
//
// Two of the three things here are real and one is not, and the page says which
// is which. The checks are rules run against the same tables the reports read —
// duplicate supplier invoice numbers, invoices near the IRN deadline, MSME
// bills approaching 45 days. The answers are a router: a question maps to a
// report that already exists, and the figure that comes back is the one that
// report would show.
//
// Neither is a language model, and calling them one would be the wrong kind of
// impressive. An accounting assistant that occasionally invents a number is
// worse than no assistant at all.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, CheckCircle2, Info, Loader2, ScanLine, Send, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { AsyncPage } from '@/components/shared/async-state';
import { api } from '@/lib/api/client';
import { useApi } from '@/lib/api/use-api';
import { cn } from '@/lib/utils';

const SUGGESTED = [
  'Which invoices are overdue?',
  'Who are my top customers?',
  'What is my GST liability?',
  'How much cash do I have?',
  'Am I making a profit?',
];

interface Flag {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  href: string;
  count: number;
}

interface FlagsResponse {
  flags: Flag[];
  summary: { high: number; medium: number; low: number };
}

interface AnswerResponse {
  answer: string;
  rows: { label: string; value: string }[];
  source: string;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  rows?: { label: string; value: string }[];
  source?: string;
}

const SEVERITY: Record<Flag['severity'], string> = {
  high: 'border-destructive/40 text-destructive',
  medium: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
  low: 'border-muted-foreground/30 text-muted-foreground',
};

export default function AiPage() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const flags = useApi<FlagsResponse>(() => api.get('/api/insights', { view: 'flags' }), []);

  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      text: 'Ask about your books. Every answer is a report being run — the figures are the same ones the reports show, because they come from the same queries.',
    },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const ask = async (q: string) => {
    if (!q.trim() || thinking) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setThinking(true);
    try {
      const res = await api.get<AnswerResponse>('/api/insights', { view: 'ask', question: q });
      setMessages((m) => [...m, { role: 'assistant', text: res.answer, rows: res.rows, source: res.source }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: 'That did not go through. The books are still there — try again.' },
      ]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Checks that run against your books, and answers that come from the reports behind them."
      />

      <Tabs defaultValue="checks">
        <TabsList>
          <TabsTrigger value="checks">
            What needs attention
            {flags.data && flags.data.flags.length > 0 && ` (${flags.data.flags.length})`}
          </TabsTrigger>
          <TabsTrigger value="ask">Ask about the books</TabsTrigger>
          <TabsTrigger value="scan">Scan a document</TabsTrigger>
        </TabsList>

        {/* Checks */}
        <TabsContent value="checks" className="mt-4 space-y-3">
          <AsyncPage state={flags}>
            {(d) =>
              d.flags.length === 0 ? (
                <Card className="flex items-center gap-3 border-emerald-500/40 bg-emerald-500/5 p-6">
                  <CheckCircle2 className="size-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <p className="font-medium">Nothing needs attention</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Every check passed against the current books.
                    </p>
                  </div>
                </Card>
              ) : (
                <>
                  {d.flags.map((f) => (
                    <Card key={f.id} className="flex flex-wrap items-start gap-4 p-4">
                      <ShieldAlert
                        className={cn(
                          'mt-0.5 size-5 shrink-0',
                          f.severity === 'high'
                            ? 'text-destructive'
                            : f.severity === 'medium'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-muted-foreground',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{f.title}</p>
                          <Badge variant="outline" className={cn('text-[10px] capitalize', SEVERITY[f.severity])}>
                            {f.severity}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.detail}</p>
                      </div>
                      <Button variant="outline" size="sm" asChild className="gap-1">
                        <Link href={f.href}>Look <ArrowRight className="size-3" /></Link>
                      </Button>
                    </Card>
                  ))}
                </>
              )
            }
          </AsyncPage>

          <Card className="flex items-start gap-3 p-4">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              These are rules, not predictions. Each one is a query over the same tables the reports read, so a
              check that fires can always be traced to the documents that made it fire — and one that does not
              fire means the condition genuinely is not there.
            </p>
          </Card>
        </TabsContent>

        {/* Ask */}
        <TabsContent value="ask" className="mt-4 space-y-3">
          <Card className="flex h-[26rem] flex-col p-0">
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4 thin-scroll">
              {messages.map((m, i) => (
                <div key={i} className={cn('flex gap-2.5', m.role === 'user' && 'justify-end')}>
                  {m.role === 'assistant' && (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10">
                      <Bot className="size-3.5 text-primary" />
                    </span>
                  )}
                  <div
                    className={cn(
                      'max-w-lg rounded-lg px-3 py-2 text-sm',
                      m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    )}
                  >
                    <p className="leading-relaxed">{m.text}</p>
                    {m.rows && m.rows.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                        {m.rows.map((r, j) => (
                          <div key={j} className="flex justify-between gap-4 text-xs">
                            <span className="text-muted-foreground">{r.label}</span>
                            <span className="tabular font-medium">{r.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.source && (
                      <Link
                        href={m.source}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        Open the report <ArrowRight className="size-2.5" />
                      </Link>
                    )}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10">
                    <Bot className="size-3.5 text-primary" />
                  </span>
                  <div className="rounded-lg bg-muted px-3 py-2">
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>

            <div className="border-t p-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SUGGESTED.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void ask(q)}
                    className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(input);
                }}
              >
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about overdue invoices, customers, GST, cash or profit…"
                />
                <Button type="submit" size="icon" disabled={thinking || !input.trim()}>
                  <Send className="size-4" />
                </Button>
              </form>
            </div>
          </Card>

          <Card className="flex items-start gap-3 p-4">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              This matches your question to a report and runs it. It is not a language model, so it will say it did
              not understand rather than guess — which is the right behaviour when the answer is a number somebody
              might file a return on.
            </p>
          </Card>
        </TabsContent>

        {/* Scan */}
        <TabsContent value="scan" className="mt-4 space-y-3">
          <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
            <ScanLine className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Document scanning is not built</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                Reading a supplier bill from a photo needs an OCR service and an extraction model behind it. Neither
                is wired up, and a screen that pretended to extract a bill would put invented figures into your
                books — which is the one thing an accounting app must never do.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/purchases/bills/new">Enter a bill by hand</Link>
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
