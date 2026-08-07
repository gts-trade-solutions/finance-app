'use client';

// Customer-facing portal — a deliberately simpler surface. No accounting
// vocabulary at all: just "what do I owe, and how do I pay it".

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle2, CreditCard, Download, FileText, Loader2, Wallet2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { useAppStore } from '@/lib/store';
import { useHydrated } from '@/lib/store/hooks';
import { ensureSeeded } from '@/lib/mock/seed';
import { effectiveInvoiceStatus, invoiceBalance } from '@/lib/selectors';
import { formatINRCompact } from '@/lib/money';

/** The portal always shows one customer's view — Sharma Traders in the demo. */
const PORTAL_CUSTOMER_ID = 'c_sharma';

export default function PortalPage() {
  const hydrated = useHydrated();
  const s = useAppStore();
  const [paying, setPaying] = useState<string | null>(null);

  useEffect(() => { if (hydrated) ensureSeeded(); }, [hydrated]);

  if (!hydrated) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  const customer = s.contacts.find((c) => c.id === PORTAL_CUSTOMER_ID);
  const invoices = s.invoices
    .filter((i) => i.customerId === PORTAL_CUSTOMER_ID && i.status !== 'void' && i.status !== 'draft')
    .sort((a, b) => b.date.localeCompare(a.date));
  const estimates = s.estimates.filter((e) => e.customerId === PORTAL_CUSTOMER_ID);
  const outstanding = invoices.reduce((t, i) => t + invoiceBalance(i), 0);
  const overdue = invoices.filter((i) => effectiveInvoiceStatus(i) === 'overdue');

  const pay = async (id: string) => {
    setPaying(id);
    await new Promise((r) => setTimeout(r, 1800));
    setPaying(null);
    toast.success('Payment gateway would open here', {
      description: 'In production this opens a Razorpay checkout and reconciles automatically on success.',
    });
  };

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Branded header */}
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary">
            <Wallet2 className="size-4 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{s.org?.name}</p>
            <p className="text-xs text-muted-foreground">Customer portal</p>
          </div>
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link href="/dashboard"><ArrowLeft className="size-3.5" /> Back to app</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 p-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hello, {customer?.displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your invoices, statements and payments in one place.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Amount due</p>
            <p className="mt-1 text-2xl font-semibold tabular">{formatINRCompact(outstanding)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Open invoices</p>
            <p className="mt-1 text-2xl font-semibold tabular">
              {invoices.filter((i) => invoiceBalance(i) > 0).length}
            </p>
          </Card>
          <Card className={'p-4 ' + (overdue.length ? 'border-amber-500/40 bg-amber-500/5' : '')}>
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="mt-1 text-2xl font-semibold tabular">{overdue.length}</p>
          </Card>
        </div>

        <Card className="p-0">
          <div className="flex items-center justify-between border-b p-4">
            <h2 className="text-sm font-semibold">Your invoices</h2>
            <Button variant="outline" size="sm" onClick={() => toast.success('Statement downloaded')} className="gap-1.5">
              <Download className="size-3.5" /> Statement
            </Button>
          </div>
          <div className="divide-y">
            {invoices.map((inv) => {
              const bal = invoiceBalance(inv);
              return (
                <div key={inv.id} className="flex flex-wrap items-center gap-4 p-4">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{inv.number}</p>
                      <StatusBadge status={effectiveInvoiceStatus(inv)} />
                      {inv.einvoice.irn && (
                        <Badge variant="outline" className="border-emerald-500/40 text-[9px]">Verified</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Issued {new Date(inv.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · due '}
                      {new Date(inv.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money value={inv.totalPaise} className="text-sm font-medium" />
                    {bal > 0 && bal !== inv.totalPaise && (
                      <p className="text-xs text-muted-foreground">
                        <Money value={bal} /> outstanding
                      </p>
                    )}
                  </div>
                  {bal > 0 ? (
                    <Button size="sm" onClick={() => pay(inv.id)} disabled={paying === inv.id} className="gap-1.5">
                      {paying === inv.id ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
                      Pay now
                    </Button>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-emerald-500/40">
                      <CheckCircle2 className="size-3" /> Paid
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {estimates.length > 0 && (
          <Card className="p-0">
            <div className="border-b p-4">
              <h2 className="text-sm font-semibold">Quotes awaiting your decision</h2>
            </div>
            <div className="divide-y">
              {estimates.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{e.number}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Valid until {new Date(e.expiryDate).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <Money value={e.totalPaise} className="text-sm font-medium" />
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => toast.info('Quote declined')}>Decline</Button>
                    <Button size="sm" onClick={() => toast.success('Quote accepted — we’ll be in touch')}>Accept</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Questions about an invoice? Reply to {s.org?.email} or call {s.org?.phone}.
        </p>
      </main>
    </div>
  );
}
