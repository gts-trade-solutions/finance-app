'use client';

// Sign-in. Real credentials against the API — the role picker this replaced was
// a demo affordance, and leaving it in a build that has a database behind it
// would be an unauthenticated door into the books.

import { useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, LogIn, ShieldCheck, Wallet2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { auth, ApiError } from '@/lib/api/client';

/** Shown only outside production, so the demo book stays easy to open. */
const DEMO_ACCOUNTS = [
  { email: 'arun@raceautospares.in', role: 'Admin', blurb: 'Everything, including settings and period locks' },
  { email: 'priya@raceautospares.in', role: 'Accountant', blurb: 'Books, banking, GST and journals' },
  { email: 'vikram@raceautospares.in', role: 'Sales', blurb: 'Quotes and invoices; costs stay hidden' },
  { email: 'deepa@raceautospares.in', role: 'Viewer', blurb: 'Read-only, for auditors' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDev = process.env.NODE_ENV !== 'production';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.login(email.trim(), password);
      // A full navigation rather than a client push, so every provider
      // re-reads the session that was just established.
      window.location.href = '/dashboard';
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not sign in. Please try again.',
      );
      setBusy(false);
    }
  };

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Finora@2026');
    setError(null);
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
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="p-6">
            <h2 className="text-lg font-semibold">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the email and password your administrator set up.
            </p>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.in"
                  required
                  disabled={busy}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={busy}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  data-slot="login-error"
                  className="flex items-start gap-2 rounded-[3px] border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full gap-2" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Sessions are held on the server, so signing out ends access immediately on every
              device. Repeated failed attempts lock the account for fifteen minutes.
            </p>
          </Card>

          {isDev && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold">Demo accounts</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Development only. Each role sees a different app — pick one to fill the form.
              </p>
              <div className="mt-4 space-y-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    data-slot="demo-account"
                    data-role={a.role.toLowerCase()}
                    onClick={() => fillDemo(a.email)}
                    className="flex w-full items-start gap-3 rounded-[3px] border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{a.role}</span>
                        <span className="truncate text-xs text-muted-foreground">{a.email}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{a.blurb}</p>
                    </div>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Password for all four: <span className="font-mono">Finora@2026</span>
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
