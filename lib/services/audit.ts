// Audit service — every service call records who did what. Append-only.

import { getState, setState } from '../store';
import { genId } from '../ledger/posting';
import type { AuditEvent } from '../types';

export function logAudit(
  action: AuditEvent['action'],
  entity: string,
  entityId: string,
  entityLabel: string,
  detail: string,
): void {
  const s = getState();
  const user = s.users.find((u) => u.id === s.session?.userId);
  const ev: AuditEvent = {
    id: genId('aud'),
    at: new Date().toISOString(),
    userId: user?.id ?? 'system',
    userName: user?.name ?? 'System (seed)',
    entity,
    entityId,
    entityLabel,
    action,
    detail,
  };
  setState({ audit: [ev, ...s.audit] });
}
