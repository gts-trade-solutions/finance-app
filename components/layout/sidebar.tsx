'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight, Wallet2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { hasPermission } from '@/lib/store/hooks';
import { NAV_GROUPS, TOP_LEVEL, BOTTOM_LEVEL, type NavItem } from './nav-config';
import { msmeTracker } from '@/lib/selectors';

/**
 * Each count is selected as a primitive. Returning an object here would build a
 * new snapshot on every render and send useSyncExternalStore into a loop.
 */
function useBadgeCounts() {
  const einvoicePending = useAppStore(
    (s) => s.invoices.filter((i) => i.einvoice.status === 'pending' || i.einvoice.status === 'failed').length,
  );
  const unmatched = useAppStore((s) => s.bankTxns.filter((t) => t.status === 'unmatched').length);
  const msmeRisk = useAppStore((s) => msmeTracker(s).filter((m) => m.risk !== 'ok').length);
  return { einvoicePending, unmatched, msmeRisk };
}

function NavLink({ item, count }: { item: NavItem; count?: number }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(item.href + '/');
  return (
    <Link
      href={item.href}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
        active
          ? 'bg-sidebar-primary/15 font-medium text-sidebar-primary-foreground'
          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
    >
      <item.icon className={cn('size-4 shrink-0', active && 'text-sidebar-primary')} />
      <span className="truncate">{item.label}</span>
      {!!count && count > 0 && (
        <span className="ml-auto rounded-full bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
          {count}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const role = useAppStore((s) => s.session?.role);
  const org = useAppStore((s) => s.org);
  const counts = useBadgeCounts();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Auto-expand the group containing the current route
  useEffect(() => {
    const g = NAV_GROUPS.find((grp) => grp.items.some((i) => pathname.startsWith(i.href)));
    if (g) setOpen((o) => ({ ...o, [g.label]: true }));
  }, [pathname]);

  const visibleGroups = NAV_GROUPS.filter((g) => hasPermission(role, g.module, 'view'));

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground" onClick={onNavigate}>
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary">
          <Wallet2 className="size-4 text-sidebar-primary-foreground" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">Finora</p>
          <p className="truncate text-[11px] text-sidebar-foreground/60">{org?.name ?? 'Demo Org'}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2.5 py-3 thin-scroll">
        {TOP_LEVEL.map((i) => (
          <NavLink key={i.href} item={i} />
        ))}

        {visibleGroups.map((group) => {
          const isOpen = open[group.label] ?? false;
          const groupCount = group.items.reduce(
            (t, i) => t + (i.badge ? counts[i.badge] : 0),
            0,
          );
          return (
            <div key={group.label} className="pt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((o) => ({ ...o, [group.label]: !isOpen }));
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <group.icon className="size-4 shrink-0" />
                <span className="truncate">{group.label}</span>
                {!isOpen && groupCount > 0 && (
                  <span className="ml-auto mr-1 rounded-full bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                    {groupCount}
                  </span>
                )}
                <ChevronRight
                  className={cn('ml-auto size-3.5 transition-transform', isOpen && 'rotate-90', groupCount > 0 && !isOpen && 'ml-0')}
                />
              </button>
              {isOpen && (
                <div className="mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3 ml-4">
                  {group.items.map((i) => (
                    <NavLink key={i.href} item={i} count={i.badge ? counts[i.badge] : undefined} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="mt-3 space-y-1 border-t border-sidebar-border pt-3">
          {BOTTOM_LEVEL.filter((i) => hasPermission(role, i.module, 'view')).map((i) => (
            <NavLink key={i.href} item={i} />
          ))}
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-4 py-2.5">
        <p className="text-[10px] leading-relaxed text-sidebar-foreground/50">
          Interactive prototype · dummy data
          <br />
          {org?.fiscalYearLabel}
        </p>
      </div>
    </div>
  );
}
