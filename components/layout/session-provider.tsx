'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The bridge between the server session and the app shell.
//
// Authentication is entirely server-side now: the browser holds an httpOnly
// cookie it cannot read, and /api/auth/me is the only way to learn who is
// signed in. This component makes that call, gates the shell on it, and hands
// the answer to migrated pages through a context.
//
// What it deliberately does NOT do is overwrite the demo store's collections
// with server data. The two use different id spaces — the server says branch
// "1", the seeded book says "br_chennai" — so merging them would leave every
// not-yet-migrated page holding references that resolve to nothing. Pages move
// to the API one at a time; until a page has moved, it keeps its own data and
// nothing about it changes.
//
// The one value that is written into the store is the role, because the
// permission hooks read it from there and the role must come from the server.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, ApiError, type SessionResponse } from '@/lib/api/client';
import { useAppStore, getState } from '@/lib/store';
import { ensureSeeded } from '@/lib/mock/seed';

export type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; session: SessionResponse }
  | { status: 'anonymous' }
  | { status: 'error'; message: string };

const SessionContext = createContext<SessionResponse | null>(null);

/** The signed-in user, org and branches as the server sees them. */
export function useSession(): SessionResponse {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used inside the app shell, which provides it.');
  }
  return ctx;
}

export function SessionGate({
  children,
  fallback,
  onError,
}: {
  children: (session: SessionResponse) => React.ReactNode;
  fallback: React.ReactNode;
  onError: (message: string) => React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    auth
      .me()
      .then((session) => {
        if (cancelled) return;

        // Pages that still read the demo store need it populated.
        ensureSeeded();

        // Match the signed-in user to their seeded counterpart by email, so the
        // store's session points at an id that exists in its own id space.
        // The role always comes from the server — a locally-edited role would
        // change which buttons render, and the API would refuse the click.
        const local = getState().users.find(
          (u) => u.email.toLowerCase() === session.user.email.toLowerCase(),
        );
        useAppStore.setState({
          session: { userId: local?.id ?? session.user.id, role: session.user.role },
        });

        setState({ status: 'authenticated', session });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.isAuthFailure) {
          setState({ status: 'anonymous' });
          router.replace('/login');
          return;
        }
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Could not reach the server.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state.status === 'error') return <>{onError(state.message)}</>;
  if (state.status !== 'authenticated') return <>{fallback}</>;

  return (
    <SessionContext.Provider value={state.session}>
      {children(state.session)}
    </SessionContext.Provider>
  );
}
