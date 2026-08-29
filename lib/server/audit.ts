import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// The audit trail.
//
// MCA Rule 11(g) requires accounting software used by Indian companies to keep
// an audit trail of every transaction, with no facility to disable it, retained
// for eight years. So there is deliberately no `disabled` flag here and no
// update or delete path anywhere in the codebase — this module only inserts.
//
// Writing an audit row must never be the reason a business action fails. If the
// insert throws, it is logged to the server console and the caller continues:
// losing one audit line is bad, refusing a customer's invoice because of it is
// worse. A caller that needs the guarantee passes its own transaction, and then
// the row lives or dies with the action it describes.
// ─────────────────────────────────────────────────────────────────────────────

import { db, type Executor } from './db';

export type AuditAction =
  | 'create' | 'update' | 'void' | 'approve' | 'send' | 'match' | 'login' | 'export' | 'import';

export interface AuditInput {
  orgId: number;
  actorUserId?: number | null;
  actorName?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | number | null;
  targetLabel?: string | null;
  detail?: string | null;
  payload?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  /** Pass a transaction to tie the audit row to the action it records. */
  trx?: Executor;
}

export async function logAudit(input: AuditInput): Promise<void> {
  const ex = input.trx ?? db;
  try {
    await ex
      .insertInto('audit_log')
      .values({
        org_id: input.orgId,
        actor_user_id: input.actorUserId ?? null,
        actor_name: input.actorName ?? null,
        action: input.action,
        target_type: input.targetType ?? null,
        target_id: input.targetId != null ? String(input.targetId) : null,
        target_label: input.targetLabel ?? null,
        detail: input.detail ?? null,
        payload: input.payload === undefined ? null : JSON.stringify(input.payload),
        ip: input.ip ?? null,
        user_agent: input.userAgent?.slice(0, 500) ?? null,
      })
      .execute();
  } catch (err) {
    // Only swallowed for fire-and-forget calls. Inside a caller's transaction
    // the error propagates, because there the row is part of the action.
    if (input.trx) throw err;
    console.error('[audit] failed to record', input.action, input.targetType, err);
  }
}

/** Request metadata worth recording alongside an action. */
export function auditMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent'),
  };
}
