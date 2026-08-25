'use client';

// Zoho-style navigation: navy rail, collapsible module groups, and sub-items as
// plain indented text. The active row carries a "+" that jumps straight to the
// create form for that module — the affordance that saves a click everywhere.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight, Plus, Wallet2 } from 'lucide-react';
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

function NavRow({
  item,
  count,
  nested,
}: {
  item: NavItem;
  count?: number;
  nested?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(item.href + '/');
  const createHref = CREATE_HREF[item.href];

  return (
    <div className="group/row relative">
      <Link
        href={item.href}
        className={cn(
          'flex h-8 items-center gap-2.5 rounded-sm pr-2 text-[13px] transition-colors',
          nested ? 'pl-9' : 'pl-3',
          active
            ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )}
      >
        {!nested && <item.icon className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {count != null && count > 0 && (
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold tabular',
              active ? 'bg-white/25 text-white' : 'bg-sidebar-accent text-sidebar-accent-foreground',
            )}
          >
            {count}
          </span>
        )}
      </Link>
      {createHref && (
        <Link
          href={createHref}
          aria-label={`New ${item.label}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full opacity-0 transition-opacity',
            'group-hover/row:opacity-100 focus-visible:opacity-100',
            active ? 'bg-white text-sidebar-primary' : 'bg-sidebar-primary text-white',
          )}
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

  // Keep the group containing the current route expanded.
  useEffect(() => {
    const group = NAV_GROUPS.find((g) => g.items.some((i) => pathname.startsWith(i.href)));
    if (group) setOpen((o) => ({ ...o, [group.label]: true }));
  }, [pathname]);

  const visible = (module: string) => hasPermission(role, module, 'view');

  return (
    <div className="flex h-full flex-col bg-sidebar" onClick={onNavigate}>
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4"
      >
        <div className="grid size-7 shrink-0 place-items-center rounded bg-sidebar-primary">
          <Wallet2 className="size-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-white">Finora</p>
          <p className="truncate text-[10px] leading-tight text-sidebar-foreground/60">
            {org?.fiscalYearLabel ?? 'Books'}
          </p>
        </div>
      </Link>

      <nav className="thin-scroll flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
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
                  'flex h-8 w-full items-center gap-2.5 rounded-sm px-3 text-[13px] transition-colors',
                  groupActive && !isOpen
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <group.icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                <ChevronRight
                  className={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')}
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

        <div className="!mt-3 border-t border-sidebar-border pt-3">
          {BOTTOM_LEVEL.filter((i) => visible(i.module)).map((item) => (
            <NavRow key={item.href} item={item} />
          ))}
        </div>
      </nav>
    </div>
  );
}
