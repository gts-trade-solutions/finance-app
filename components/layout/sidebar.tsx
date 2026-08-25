'use client';

// Editorial navigation: a pale ivory column separated from the workspace by a
// hairline, not a slab of colour. The active row is marked by a gilt bar and
// ink-weight type rather than a filled block, which keeps the eye calm while
// still being unmistakable.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { hasPermission } from '@/lib/store/hooks';
import { msmeTracker } from '@/lib/selectors';
import { BOTTOM_LEVEL, NAV_GROUPS, TOP_LEVEL, type NavItem } from './nav-config';

/** Where the "+" on a nav row should go, when that module has a create form. */
const CREATE_HREF: Record<string, string> = {
  '/sales/customers': '/sales/customers/new',
  '/sales/invoices': '/sales/invoices/new',
  '/sales/payments': '/sales/payments/new',
  '/purchases/bills': '/purchases/bills/new',
  '/purchases/payments': '/purchases/payments/new',
};

/**
 * Counts are selected as primitives. Returning an object from a Zustand
 * selector builds a new snapshot each render and loops useSyncExternalStore.
 */
function useBadgeCounts() {
  const einvoicePending = useAppStore(
    (s) => s.invoices.filter((i) => i.einvoice.status === 'pending' || i.einvoice.status === 'failed').length,
  );
  const unmatched = useAppStore((s) => s.bankTxns.filter((t) => t.status === 'unmatched').length);
  const msmeRisk = useAppStore((s) => msmeTracker(s).filter((m) => m.risk !== 'ok').length);
  return { einvoicePending, unmatched, msmeRisk };
}

function NavRow({ item, count, nested }: { item: NavItem; count?: number; nested?: boolean }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(item.href + '/');
  const createHref = CREATE_HREF[item.href];

  return (
    <div className="group/row relative">
      {/* Gilt marker instead of a filled active block */}
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-gilt" />
      )}
      <Link
        href={item.href}
        className={cn(
          'flex h-9 items-center gap-2.5 rounded-md pr-2 text-[13.5px] transition-colors',
          nested ? 'pl-9' : 'pl-3',
          active
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
        )}
      >
        {!nested && <item.icon className={cn('size-[17px] shrink-0', active ? 'opacity-90' : 'opacity-70')} />}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {count != null && count > 0 && (
          <span className="shrink-0 rounded-full bg-foreground/8 px-1.5 py-px text-[10px] font-semibold tabular text-muted-foreground">
            {count}
          </span>
        )}
      </Link>
      {createHref && (
        <Link
          href={createHref}
          aria-label={`New ${item.label}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
        >
          <Plus className="size-3" />
        </Link>
      )}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const role = useAppStore((s) => s.session?.role);
  const org = useAppStore((s) => s.org);
  const counts = useBadgeCounts();

  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const group = NAV_GROUPS.find((g) => g.items.some((i) => pathname.startsWith(i.href)));
    if (group) setOpen((o) => ({ ...o, [group.label]: true }));
  }, [pathname]);

  const visible = (module: string) => hasPermission(role, module, 'view');

  return (
    <div className="flex h-full flex-col border-r bg-sidebar" onClick={onNavigate}>
      {/* Wordmark */}
      <Link href="/dashboard" className="flex h-16 shrink-0 flex-col justify-center gap-0.5 px-5">
        <span className="font-display text-[19px] leading-none tracking-tight text-foreground">
          Finora
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {org?.fiscalYearLabel ?? 'Books'}
        </span>
      </Link>

      <nav className="thin-scroll flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {TOP_LEVEL.filter((i) => visible(i.module)).map((item) => (
          <NavRow key={item.href} item={item} />
        ))}

        {NAV_GROUPS.filter((g) => visible(g.module)).map((group) => {
          const isOpen = open[group.label] ?? false;
          const groupActive = group.items.some((i) => pathname.startsWith(i.href));
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((o) => ({ ...o, [group.label]: !isOpen }));
                }}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-[13.5px] transition-colors',
                  groupActive && !isOpen
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                )}
              >
                <group.icon className="size-[17px] shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                <ChevronRight
                  className={cn('size-3.5 shrink-0 opacity-50 transition-transform', isOpen && 'rotate-90')}
                />
              </button>
              {isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {group.items.filter((i) => visible(i.module)).map((item) => (
                    <NavRow
                      key={item.href}
                      item={item}
                      nested
                      count={item.badge ? counts[item.badge] : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="!mt-4 space-y-0.5 border-t pt-4">
          {BOTTOM_LEVEL.filter((i) => visible(i.module)).map((item) => (
            <NavRow key={item.href} item={item} />
          ))}
        </div>
      </nav>
    </div>
  );
}
