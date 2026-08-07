'use client';

// Small store-adjacent hooks used across the UI.

import { useEffect, useState } from 'react';
import { useAppStore } from './index';
import type { RoleName } from '../types';

/** True once zustand-persist has rehydrated from localStorage (avoids SSR flicker). */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // persist.onFinishHydration fires after rehydrate; if already done, flag now
    const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAppStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  return hydrated;
}

// ── RBAC ─────────────────────────────────────────────────────────────────────
// Permission matrix for the demo. module keys are coarse ('sales', 'purchases',
// 'banking', 'accountant', 'gst', 'reports', 'settings', 'inventory').

type Action = 'view' | 'create' | 'edit' | 'approve' | 'void';

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

export function usePermission(module: string, action: Action = 'view'): boolean {
  const role = useAppStore((s) => s.session?.role);
  return hasPermission(role, module, action);
}

/** Sales role must not see purchase prices / profit figures. */
export function useCanSeeCosts(): boolean {
  const role = useAppStore((s) => s.session?.role);
  return role === 'admin' || role === 'accountant' || role === 'viewer';
}
