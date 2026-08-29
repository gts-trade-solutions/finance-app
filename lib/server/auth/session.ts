import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// Sessions.
//
// Server-side, in a table, rather than a self-contained JWT. The difference
// that matters for a finance system: when an admin disables a user or someone
// signs out, access has to stop *now*. A JWT cannot be recalled — it stays
// valid until it expires, and the usual workaround is a revocation list, which
// is a sessions table with extra steps.
//
// The cookie carries a random token. What is stored is its SHA-256, so a
// database leak does not hand over live sessions — the same reason you store
// password hashes rather than passwords.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { RoleName } from '../../types';
import { db } from '../db';

export const SESSION_COOKIE = 'finora_session';

const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS) || 168; // one week

export interface SessionUser {
  userId: number;
  orgId: number;
  name: string;
  email: string;
  role: RoleName;
  homeBranchId: number | null;
  activeBranchId: number | null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** 256 bits of randomness, url-safe. Long enough that guessing is not a threat. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function expiryFromNow(): Date {
  return new Date(Date.now() + TTL_HOURS * 3600_000);
}

export async function createSession(
  userId: number,
  orgId: number,
  meta: { ip?: string | null; userAgent?: string | null; activeBranchId?: number | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = expiryFromNow();

  await db
    .insertInto('sessions')
    .values({
      token_hash: sha256(token),
      user_id: userId,
      org_id: orgId,
      active_branch_id: meta.activeBranchId ?? null,
      ip: meta.ip ?? null,
      user_agent: meta.userAgent?.slice(0, 500) ?? null,
      expires_at: expiresAt,
      last_seen_at: new Date(),
    })
    .execute();

  return { token, expiresAt };
}

/**
 * Resolve a raw cookie token to the user behind it.
 *
 * Joins users so a disabled account fails here rather than three layers up,
 * and re-reads the role every request — a demotion must take effect on the
 * next click, not on the next sign-in.
 */
export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.token_hash',
      'sessions.org_id',
      'sessions.active_branch_id',
      'sessions.expires_at',
      'sessions.revoked_at',
      'users.id as user_id',
      'users.name',
      'users.email',
      'users.role',
      'users.home_branch_id',
      'users.is_active',
    ])
    .where('sessions.token_hash', '=', sha256(token))
    .executeTakeFirst();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (!row.is_active) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  return {
    userId: row.user_id,
    orgId: row.org_id,
    name: row.name,
    email: row.email,
    role: row.role as RoleName,
    homeBranchId: row.home_branch_id,
    activeBranchId: row.active_branch_id ?? row.home_branch_id,
  };
}

/** The signed-in user for the current request, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('token_hash', '=', sha256(token))
    .execute();
}

/** Sign a user out everywhere — used when a password changes or an account is disabled. */
export async function revokeAllSessions(userId: number): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
}

/** Which branch this session is acting in. Persisted so it survives a reload. */
export async function setActiveBranch(token: string | undefined, branchId: number): Promise<void> {
  if (!token) return;
  await db
    .updateTable('sessions')
    .set({ active_branch_id: branchId })
    .where('token_hash', '=', sha256(token))
    .execute();
}

/** Housekeeping: drop sessions that expired more than a week ago. */
export async function pruneSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000);
  const res = await db.deleteFrom('sessions').where('expires_at', '<', cutoff).executeTakeFirst();
  return Number(res.numDeletedRows ?? 0);
}

export const cookieOptions = (expiresAt: Date) =>
  ({
    httpOnly: true, // JavaScript cannot read it, so XSS cannot steal it
    sameSite: 'lax' as const, // blocks cross-site form posts riding the session
    secure: process.env.NODE_ENV === 'production', // plain HTTP in local dev only
    path: '/',
    expires: expiresAt,
  });

/**
 * Constant-time string comparison, for anything compared against a secret.
 *
 * `===` returns as soon as two bytes differ, and that timing difference is
 * measurable across a network for a long enough secret.
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
