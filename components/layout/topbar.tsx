'use client';

// Navy top band, matching the sidebar so the chrome reads as one frame around
// the white workspace. Carries global search (focused with "/"), the branch
// switcher, quick create, and the demo controls.

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Bell, Building2, ChevronDown, FlaskConical, LogOut, Menu, Moon, Plus,
  RefreshCw, Search, Settings, Sun, UserCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';
import { hasPermission } from '@/lib/store/hooks';
import { seedDatabase } from '@/lib/mock/seed';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { QuickCreate } from './quick-create';
import { GlobalSearch } from './global-search';

/** Icon button styled for the navy band. */
function BandButton({
  children,
  label,
  onClick,
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'grid size-8 place-items-center rounded text-topbar-foreground/75 transition-colors hover:bg-white/10 hover:text-topbar-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('finora-theme', next ? 'dark' : 'light');
  };
  return (
    <BandButton label="Toggle theme" onClick={toggle}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </BandButton>
  );
}

export function Topbar() {
  const router = useRouter();
  const { branches, activeBranchId, users, session } = useAppStore();
  const setActiveBranch = useAppStore((s) => s.setActiveBranch);
  const logout = useAppStore((s) => s.logout);
  const login = useAppStore((s) => s.login);
  const [quickOpen, setQuickOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const searchRef = useRef<HTMLButtonElement>(null);

  const user = users.find((u) => u.id === session?.userId);
  const branch = branches.find((b) => b.id === activeBranchId);
  const canCreate = hasPermission(session?.role, 'sales', 'create');

  // "/" focuses search, ⌘K / Ctrl-K opens quick create — both Zoho conventions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickOpen(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 bg-topbar px-3 sm:px-4">
        {/* Mobile nav */}
        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetTrigger
            aria-label="Open navigation"
            className="grid size-8 place-items-center rounded text-topbar-foreground/75 hover:bg-white/10 lg:hidden"
          >
            <Menu className="size-4" />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 border-0 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </SheetContent>
        </Sheet>

        {/* Search */}
        <button
          ref={searchRef}
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-8 max-w-md flex-1 items-center gap-2 rounded border border-white/15 bg-white/10 px-2.5 text-left text-[13px] text-topbar-foreground/60 transition-colors hover:bg-white/15"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search customers, invoices, bills…</span>
          <kbd className="hidden shrink-0 rounded border border-white/20 px-1 font-sans text-[10px] sm:inline">
            /
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1">
          {/* Demo org / test banner */}
          <span className="mr-1 hidden text-[11px] text-topbar-foreground/60 xl:inline">
            Demo data · nothing is filed with any portal
          </span>

          {/* Branch (GSTIN) switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-8 items-center gap-1.5 rounded px-2 text-[13px] text-topbar-foreground/85 transition-colors hover:bg-white/10">
              <Building2 className="size-3.5 shrink-0" />
              <span className="hidden max-w-[130px] truncate sm:inline">{branch?.name ?? 'Branch'}</span>
              <ChevronDown className="size-3 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Branch &amp; GST registration</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {branches.map((b) => (
                <DropdownMenuItem key={b.id} onClick={() => setActiveBranch(b.id)}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{b.name}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">{b.gstin}</p>
                  </div>
                  {b.id === activeBranchId && <Badge variant="secondary" className="ml-2 text-[9px]">Active</Badge>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Quick create */}
          {canCreate && (
            <button
              type="button"
              onClick={() => setQuickOpen(true)}
              aria-label="Quick create"
              className="grid size-8 place-items-center rounded bg-sidebar-primary text-white transition-opacity hover:opacity-90"
            >
              <Plus className="size-4" />
            </button>
          )}

          <BandButton label="Notifications" onClick={() => toast.info('No new notifications')}>
            <Bell className="size-4" />
          </BandButton>
          <ThemeToggle />
          <BandButton label="Settings" onClick={() => router.push('/settings')}>
            <Settings className="size-4" />
          </BandButton>

          {/* Demo controls */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-8 items-center gap-1.5 rounded px-2 text-[13px] text-topbar-foreground/85 transition-colors hover:bg-white/10">
              <FlaskConical className="size-3.5" />
              <span className="hidden md:inline">Demo</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Sign in as</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {users.map((u) => (
                <DropdownMenuItem
                  key={u.id}
                  onClick={() => {
                    login(u.id, u.role);
                    toast.success(`Now viewing as ${u.name}`, { description: `Role: ${u.role}` });
                  }}
                >
                  <span
                    className="mr-2 grid size-5 place-items-center rounded-full text-[9px] font-semibold text-white"
                    style={{ backgroundColor: u.avatarColor }}
                  >
                    {u.name.split(' ').map((n) => n[0]).join('')}
                  </span>
                  <span className="flex-1 truncate">{u.name}</span>
                  <span className="text-[10px] capitalize text-muted-foreground">{u.role}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Demo data</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  // keepSession, or resetting the demo signs the user out and
                  // bounces them to /login mid-walkthrough.
                  seedDatabase({ keepSession: true });
                  toast.success('Reset to seed data', {
                    description: 'Every document, entry and match is back to its starting state.',
                  });
                }}
              >
                <RefreshCw className="mr-2 size-4" /> Reset to seed data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Account */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Account"
              className="ml-0.5 grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
              style={{ backgroundColor: user?.avatarColor ?? 'var(--primary)' }}
            >
              {user?.name.split(' ').map((n) => n[0]).join('') ?? '?'}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="font-medium">{user?.name}</p>
                <p className="text-xs font-normal text-muted-foreground">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/settings')}>
                <UserCircle2 className="mr-2 size-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  logout();
                  router.replace('/login');
                }}
              >
                <LogOut className="mr-2 size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <QuickCreate open={quickOpen} onOpenChange={setQuickOpen} />
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
