import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/server/db';
import { verifyPassword, fakeVerify } from '@/lib/server/auth/password';
import { createSession, cookieOptions, SESSION_COOKIE } from '@/lib/server/auth/session';
import { route, body, ApiError, asId } from '@/lib/server/http';
import { logAudit } from '@/lib/server/audit';

const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

/** Lock an account after this many consecutive failures. */
const MAX_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

export const POST = route(
  async ({ req }) => {
    const { email, password } = await body(req, LoginInput);
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent');

    const user = await db
      .selectFrom('users')
      .select([
        'id', 'org_id', 'name', 'email', 'password_hash', 'role',
        'home_branch_id', 'is_active', 'failed_logins', 'locked_until',
      ])
      .where('email', '=', email)
      .executeTakeFirst();

    // One message for every failure below, and a matching amount of work when
    // the account does not exist. Telling the caller whether an email is
    // registered turns the login form into a customer list.
    const reject = () => new ApiError(401, 'Email or password is incorrect.', 'invalid_credentials');

    if (!user) {
      await fakeVerify();
      throw reject();
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60_000);
      throw new ApiError(
        429,
        `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        'locked',
      );
    }

    if (!user.password_hash) {
      await fakeVerify();
      throw new ApiError(
        403,
        'This account has not been set up yet. Ask an admin to send an invitation.',
        'no_password',
      );
    }

    const ok = await verifyPassword(user.password_hash, password);

    if (!ok) {
      const attempts = user.failed_logins + 1;
      await db
        .updateTable('users')
        .set({
          failed_logins: attempts,
          locked_until:
            attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        })
        .where('id', '=', user.id)
        .execute();

      await logAudit({
        orgId: user.org_id,
        actorUserId: user.id,
        actorName: user.name,
        action: 'login',
        targetType: 'session',
        targetId: String(user.id),
        detail: `Failed sign-in (attempt ${attempts})`,
        ip,
        userAgent,
      });

      throw reject();
    }

    if (!user.is_active) {
      throw new ApiError(403, 'This account has been disabled.', 'disabled');
    }

    // A clean sign-in clears the counter, so a user who mistypes twice and then
    // succeeds does not carry those failures towards a future lockout.
    await db
      .updateTable('users')
      .set({ failed_logins: 0, locked_until: null, last_login_at: new Date() })
      .where('id', '=', user.id)
      .execute();

    const { token, expiresAt } = await createSession(user.id, user.org_id, {
      ip,
      userAgent,
      activeBranchId: user.home_branch_id,
    });

    await logAudit({
      orgId: user.org_id,
      actorUserId: user.id,
      actorName: user.name,
      action: 'login',
      targetType: 'session',
      targetId: String(user.id),
      detail: 'Signed in',
      ip,
      userAgent,
    });

    const res = NextResponse.json({
      user: {
        id: asId(user.id),
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.home_branch_id ? asId(user.home_branch_id) : null,
      },
    });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
    return res;
  },
  { public: true },
);
