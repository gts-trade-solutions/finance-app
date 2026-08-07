'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Building2, ChevronDown, FlaskConical, LogOut, Menu, Moon, Plus, RefreshCw,
  Sun, UserCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';
import { hasPermission } from '@/lib/store/hooks';
import { seedDatabase } from '@/lib/mock/seed';
import { Sidebar } from './sidebar';
import { QuickCreate } from './quick-create';
import { toast } from 'sonner';

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
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function Topbar() {
  const router = useRouter();
  const { org, branches, activeBranchId, users, session } = useAppStore();
  const setActiveBranch = useAppStore((s) => s.setActiveBranch);
  const logout = useAppStore((s) => s.logout);
  const login = useAppStore((s) => s.login);
  const [quickOpen, setQuickOpen] = useState(false);

  const user = users.find((u) => u.id === session?.userId);
  const branch = branches.find((b) => b.id === activeBranchId);
  const canCreate = hasPermission(session?.role, 'sales', 'create');

  // ⌘K / Ctrl-K quick create
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 no-print sm:px-4">
      {/* Mobile nav */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden">
            <Menu className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Branch switcher — demonstrates multi-GSTIN */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Building2 className="size-3.5" />
            <span className="hidden sm:inline">{branch?.name ?? 'Branch'}</span>
            <Badge variant="secondary" className="hidden font-mono text-[10px] md:inline-flex">
              {branch?.gstin}
            </Badge>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Branch / GSTIN</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {branches.map((b) => (
            <DropdownMenuItem key={b.id} onClick={() => setActiveBranch(b.id)} className="flex-col items-start gap-0.5">
              <span className="font-medium">{b.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{b.gstin}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-1.5">
        {canCreate && (
          <Button size="sm" className="gap-1.5" onClick={() => setQuickOpen(true)}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">New</span>
            <kbd className="ml-1 hidden rounded border border-primary-foreground/25 px-1 text-[10px] opacity-70 lg:inline">
              ⌘K
            </kbd>
          </Button>
        )}

        {/* Demo controls — resets/reloads the dummy dataset */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <FlaskConical className="size-3.5" />
              <span className="hidden md:inline">Demo</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Demo controls</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                seedDatabase({ keepSession: true });
                toast.success('Demo data reset', { description: 'All records restored to the seeded dataset.' });
                router.refresh();
              }}
            >
              <RefreshCw className="mr-2 size-4" /> Reset to seed data
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                seedDatabase({ rich: true, keepSession: true });
                toast.success('Rich dataset loaded', { description: 'Extra history added for a denser walkthrough.' });
                router.refresh();
              }}
            >
              <FlaskConical className="mr-2 size-4" /> Load rich dataset
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              Switch role to see permissions change
            </DropdownMenuLabel>
            {users.map((u) => (
              <DropdownMenuItem
                key={u.id}
                onClick={() => {
                  login(u.id, u.role);
                  toast.info(`Now viewing as ${u.name}`, { description: `Role: ${u.role}` });
                }}
              >
                <span
                  className="mr-2 size-2 rounded-full"
                  style={{ backgroundColor: u.avatarColor }}
                />
                {u.name}
                <span className="ml-auto text-[11px] capitalize text-muted-foreground">{u.role}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 px-2">
              <span
                className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                style={{ backgroundColor: user?.avatarColor ?? '#6366f1' }}
              >
                {user?.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </span>
              <span className="hidden text-sm lg:inline">{user?.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span>{user?.name}</span>
              <span className="text-[11px] font-normal capitalize text-muted-foreground">
                {session?.role} · {org?.name}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/settings')}>
              <UserCircle2 className="mr-2 size-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                logout();
                router.push('/login');
              }}
            >
              <LogOut className="mr-2 size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <QuickCreate open={quickOpen} onOpenChange={setQuickOpen} />
    </header>
  );
}
