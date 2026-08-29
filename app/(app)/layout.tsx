'use client';

import { AlertCircle } from 'lucide-react';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionGate } from '@/components/layout/session-provider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // The server decides whether there is a session. A client-side check would
  // let anyone who edits localStorage into the shell.
  return (
    <SessionGate
      fallback={
        <div className="flex h-screen">
          <div className="hidden w-64 shrink-0 border-r bg-sidebar lg:block" />
          <div className="flex-1">
            <div className="h-16 border-b bg-topbar" />
            <div className="space-y-4 p-6">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        </div>
      }
      onError={(message) => (
        <div className="grid min-h-screen place-items-center p-6">
          <div className="max-w-md text-center">
            <AlertCircle className="mx-auto mb-3 size-8 text-destructive" />
            <h1 className="text-lg font-semibold">Cannot reach the server</h1>
            <p className="mt-2 text-sm text-muted-foreground">{message}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Nothing was loaded, so nothing could have been changed.
            </p>
          </div>
        </div>
      )}
    >
      {() => (
        <TooltipProvider>
          <div className="flex h-screen overflow-hidden bg-background">
            <aside className="hidden w-64 shrink-0 lg:block">
              <Sidebar />
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <main className="thin-scroll flex-1 overflow-y-auto">
                <div className="mx-auto max-w-[1440px] space-y-7 p-5 sm:p-8">{children}</div>
              </main>
            </div>
          </div>
        </TooltipProvider>
      )}
    </SessionGate>
  );
}
