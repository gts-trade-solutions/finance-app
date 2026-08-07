'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ArrowRight, ShieldCheck, Wallet2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';
import { useHydrated } from '@/lib/store/hooks';
import { ensureSeeded } from '@/lib/mock/seed';
import { logAudit } from '@/lib/services/audit';

const ROLE_BLURB: Record<string, string> = {
  admin: 'Full access — can approve, void, close periods and manage settings.',
  accountant: 'Books, banking, GST filings and journals. Cannot change org settings.',
  sales: 'Quotes, invoices and customers only. Purchase costs and profit are hidden.',
  viewer: 'Read-only across the app. Useful for auditors and stakeholders.',
};

export default function LoginPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const users = useAppStore((s) => s.users);
  const login = useAppStore((s) => s.login);

  useEffect(() => {
    if (hydrated) ensureSeeded();
  }, [hydrated]);

  const signIn = (userId: string, role: string) => {
    login(userId, role as never);
    logAudit('login', 'session', userId, users.find((u) => u.id === userId)?.name ?? userId, `Signed in as ${role}`);
    router.push('/dashboard');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-4xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary">
            <Wallet2 className="size-6 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Finora</h1>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Double-entry accounting, GST compliance and banking for Indian business.
            This is an interactive prototype running on dummy data — pick a role to explore.
          </p>
          <Badge variant="secondary" className="mt-3 gap-1.5">
            <ShieldCheck className="size-3" />
            Prototype · no backend · data stays in your browser
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {users.map((u) => (
            <Card
              key={u.id}
              onClick={() => signIn(u.id, u.role)}
              className="group cursor-pointer p-4 transition-all hover:border-primary/50 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ backgroundColor: u.avatarColor }}
                >
                  {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{u.name}</p>
                    <Badge variant="outline" className="capitalize">{u.role}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{ROLE_BLURB[u.role]}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
            </Card>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Race Auto Spares Pvt Ltd · FY 2026-27 · Chennai (33) &amp; Bengaluru (29) branches
        </p>
      </div>
    </div>
  );
}
