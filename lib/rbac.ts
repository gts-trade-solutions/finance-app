// ─────────────────────────────────────────────────────────────────────────────
// The permission matrix. Deliberately framework-neutral — no 'use client', no
// React — because it is needed in two places:
//
//   * the UI, to decide which buttons and menus to render;
//   * the API, to decide whether a request is allowed at all.
//
// Only the second one is a control. A hidden button is a courtesy; anyone can
// call the endpoint directly. Keeping one matrix means the two can never
// disagree about what a role may do.
// ─────────────────────────────────────────────────────────────────────────────

import type { RoleName } from './types';

export type Action = 'view' | 'create' | 'edit' | 'approve' | 'void';

const MATRIX: Record<RoleName, Record<string, Action[]>> = {
  admin: {
    '*': ['view', 'create', 'edit', 'approve', 'void'],
  },
  accountant: {
    sales: ['view', 'create', 'edit', 'approve', 'void'],
    purchases: ['view', 'create', 'edit', 'approve', 'void'],
    banking: ['view', 'create', 'edit', 'approve', 'void'],
    accountant: ['view', 'create', 'edit', 'approve', 'void'],
    gst: ['view', 'create', 'edit', 'approve'],
    inventory: ['view', 'create', 'edit'],
    reports: ['view'],
    settings: ['view'],
    ai: ['view', 'create'],
  },
  sales: {
    sales: ['view', 'create', 'edit'],
    reports: ['view'],
    inventory: ['view'],
    ai: ['view'],
  },
  staff: {
    sales: ['view', 'create'],
    purchases: ['view', 'create'],
    inventory: ['view'],
    ai: ['view'],
  },
  viewer: {
    sales: ['view'],
    purchases: ['view'],
    banking: ['view'],
    accountant: ['view'],
    gst: ['view'],
    reports: ['view'],
    inventory: ['view'],
    ai: ['view'],
  },
};

export function hasPermission(role: RoleName | undefined, module: string, action: Action): boolean {
  if (!role) return false;
  const m = MATRIX[role];
  if (m['*']?.includes(action)) return true;
  return m[module]?.includes(action) ?? false;
}
