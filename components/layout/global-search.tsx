'use client';

// Global search — Zoho's "/" shortcut. Searches every entity type at once and
// groups the hits, so you can jump to a customer, an invoice or a bill without
// first navigating to the right module.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, FileText, Package, Receipt, Search, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAppStore } from '@/lib/store';
import { contactName } from '@/lib/selectors';
import { formatINR } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Hit {
  id: string;
  group: string;
  icon: LucideIcon;
  label: string;
  sublabel: string;
  meta?: string;
  href: string;
}

export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const s = useAppStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Hit[] = [];
    const match = (...parts: (string | null | undefined)[]) =>
      parts.some((p) => p?.toLowerCase().includes(q));

    for (const c of s.contacts) {
      if (c.isArchived || !match(c.displayName, c.gstin, c.email, c.phone)) continue;
      const isCustomer = c.kind === 'customer' || c.kind === 'both';
      out.push({
        id: c.id,
        group: isCustomer ? 'Customers' : 'Vendors',
        icon: isCustomer ? Users : Building2,
        label: c.displayName,
        sublabel: c.gstin ?? c.email ?? c.gstTreatment.replace(/_/g, ' '),
        href: isCustomer ? `/sales/customers/${c.id}` : '/purchases/vendors',
      });
    }

    for (const i of s.invoices) {
      if (!match(i.number, contactName(s, i.customerId))) continue;
      out.push({
        id: i.id,
        group: 'Invoices',
        icon: Receipt,
        label: i.number,
        sublabel: contactName(s, i.customerId),
        meta: formatINR(i.totalPaise),
        href: `/sales/invoices/${i.id}`,
      });
    }

    for (const b of s.bills) {
      if (!match(b.internalNo, b.number, contactName(s, b.vendorId))) continue;
      out.push({
        id: b.id,
        group: 'Bills',
        icon: FileText,
        label: `${b.internalNo} · ${b.number}`,
        sublabel: contactName(s, b.vendorId),
        meta: formatINR(b.totalPaise),
        href: `/purchases/bills/${b.id}`,
      });
    }

    for (const it of s.items) {
      if (it.isArchived || !match(it.name, it.sku, it.hsnSac)) continue;
      out.push({
        id: it.id,
        group: 'Items',
        icon: Package,
        label: it.name,
        sublabel: `${it.sku} · HSN ${it.hsnSac}`,
        meta: formatINR(it.salePricePaise),
        href: '/sales/items',
      });
    }

    for (const p of s.payments) {
      if (!match(p.number, p.reference, contactName(s, p.contactId))) continue;
      out.push({
        id: p.id,
        group: 'Payments',
        icon: Wallet,
        label: p.number,
        sublabel: contactName(s, p.contactId),
        meta: formatINR(p.amountPaise),
        href: p.kind === 'received' ? '/sales/payments' : '/purchases/payments',
      });
    }

    return out.slice(0, 40);
  }, [query, s]);

  const grouped = useMemo(() => {
    const m = new Map<string, Hit[]>();
    for (const h of hits) m.set(h.group, [...(m.get(h.group) ?? []), h]);
    return [...m.entries()];
  }, [hits]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (h: Hit) => {
    onOpenChange(false);
    router.push(h.href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>

        <div className="flex items-center gap-2.5 border-b px-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]); }
            }}
            placeholder="Search customers, invoices, bills, items…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="thin-scroll max-h-[52vh] overflow-y-auto py-1.5">
          {!query.trim() ? (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">
              Start typing to search across every module.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group}>
                <p className="px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
                {items.map((h) => {
                  const idx = hits.indexOf(h);
                  const isActive = idx === active;
                  return (
                    <button
                      key={`${h.group}-${h.id}`}
                      type="button"
                      data-active={isActive}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(h)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left',
                        isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                      )}
                    >
                      <h.icon className={cn('size-4 shrink-0', !isActive && 'text-muted-foreground')} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{h.label}</p>
                        <p className={cn('truncate text-xs', isActive ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                          {h.sublabel}
                        </p>
                      </div>
                      {h.meta && (
                        <span className={cn('shrink-0 text-xs tabular', isActive ? 'text-primary-foreground/85' : 'text-muted-foreground')}>
                          {h.meta}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
