'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { useAppStore } from '@/lib/store';
import { useHydrated } from '@/lib/store/hooks';
import { ensureSeeded } from '@/lib/mock/seed';
import { Skeleton } from '@/components/ui/skeleton';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const session = useAppStore((s) => s.session);

  // Seed on first run, then gate on the fake session.
  useEffect(() => {
    if (!hydrated) return;
    ensureSeeded();
    if (!session) router.replace('/login');
  }, [hydrated, session, router]);

  if (!hydrated || !session) {
    return (
      <div className="flex h-screen">
        <div className="hidden w-64 shrink-0 bg-sidebar lg:block" />
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r lg:block">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto thin-scroll">
          <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
