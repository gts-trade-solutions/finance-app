'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Hydrate the store's master data from the API.
//
// The migration strategy, in one file. Dozens of forms read customers, items,
// HSN codes and accounts out of the Zustand store through helpers like
// `customerOptions(s)`, and the line editor does the same internally. Rewriting
// every one of them to fetch for itself would be a very large change with a
// very large surface for mistakes.
//
// Instead the masters are loaded once and written into the store under the
// server's own ids. Every existing form keeps working untouched, but the data
// it shows is real and the id it submits is the one the API expects. Writes
// then move to the API page by page, which is the part that actually needs
// care — a read showing stale data is a nuisance, a write going to the wrong
// place is a lost document.
//
// Only what a migrated page reads is mirrored. Accounts and bank accounts are
// deliberately left alone: the seeded journal entries and bank lines that the
// not-yet-migrated ledger, banking and report screens read still reference the
// local ids, and replacing the account list underneath them would leave every
// one of those rows pointing at nothing. Each of those collections switches
// over when its own pages do.
//
// Documents are never mirrored — those are the things that change while you
// are looking at them.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { api } from './client';
import { useAppStore } from '@/lib/store';
import type { Account, Contact, HsnCode, Item, User } from '@/lib/types';

interface MastersResponse {
  contacts: {
    id: string; kind: 'customer' | 'vendor' | 'both'; displayName: string;
    gstin: string | null; gstTreatment: string; stateCode: string;
    email: string | null; phone: string | null; paymentTerms: string | null;
    isMsme: boolean; tdsSection: string | null; billingAddress: string | null;
  }[];
  items: {
    id: string; kind: 'goods' | 'service'; name: string; sku: string | null;
    hsnSac: string | null; uqc: string; salePricePaise: number;
    purchasePricePaise: number; gstRatePct: number; taxPref: string;
  }[];
  hsnCodes: {
    id: string; code: string; kind: 'hsn' | 'sac'; description: string;
    gstRatePct: number; uqc: string | null; isActive: boolean;
  }[];
  branches: {
    id: string; name: string; gstin: string | null; stateCode: string;
    address: string | null; isPrimary: boolean;
  }[];
  users: {
    id: string; name: string; email: string; role: string;
    branchId: string | null; branchAccess: string[];
  }[];
  accounts: {
    id: string; code: string; name: string; type: Account['type'];
    subtype: string | null; isSystem: boolean;
  }[];
  bankAccounts: {
    id: string; kind: string; name: string; bankName: string | null;
    accountLast4: string | null; ledgerAccountId: string;
  }[];
  nextInvoiceNumber: string | null;
}

const AVATAR = ['#4f7ce8', '#2fa4a0', '#e0883a', '#8a63d2', '#d9556b', '#3f9f5f'];
const colorFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR[h % AVATAR.length];
};

/** Split a stored one-line address back into the shape the forms expect. */
function address(line: string | null, stateCode: string) {
  const parts = (line ?? '').split(',').map((s) => s.trim());
  return {
    label: 'Billing',
    line1: parts[0] ?? '',
    city: parts[1] ?? '',
    stateCode,
    pincode: parts[2] ?? '',
  };
}

export function useMasters(): { ready: boolean; error: string | null; nextInvoiceNumber: string | null } {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextInvoiceNumber, setNext] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .get<MastersResponse>('/api/masters')
      .then((m) => {
        if (cancelled) return;

        useAppStore.setState({
          contacts: m.contacts.map<Contact>((c) => ({
            id: c.id,
            kind: c.kind,
            displayName: c.displayName,
            companyName: c.displayName,
            gstin: c.gstin,
            gstTreatment: c.gstTreatment as Contact['gstTreatment'],
            pan: null,
            stateCode: c.stateCode,
            email: c.email ?? '',
            phone: c.phone ?? '',
            billingAddress: address(c.billingAddress, c.stateCode),
            paymentTermsDays: Number(c.paymentTerms?.replace('net_', '') || 0),
            creditLimit: null,
            isMsme: c.isMsme,
            tdsSection: c.tdsSection ?? undefined,
            openingBalance: 0,
            isArchived: false,
          })),

          items: m.items.map<Item>((i) => ({
            id: i.id,
            kind: i.kind,
            name: i.name,
            sku: i.sku ?? '',
            hsnSac: i.hsnSac ?? '',
            uqc: i.uqc,
            salePricePaise: i.salePricePaise,
            purchasePricePaise: i.purchasePricePaise,
            gstRatePct: i.gstRatePct,
            taxPref: i.taxPref as Item['taxPref'],
            saleAccountId: '',
            purchaseAccountId: '',
            isArchived: false,
          })),

          hsnCodes: m.hsnCodes.map<HsnCode>((h) => ({
            id: h.id,
            code: h.code,
            kind: h.kind,
            description: h.description,
            gstRatePct: h.gstRatePct,
            uqc: h.uqc ?? undefined,
            isActive: h.isActive,
          })),

          branches: m.branches.map((b) => ({
            id: b.id,
            name: b.name,
            gstin: b.gstin ?? '',
            stateCode: b.stateCode,
            address: b.address ?? '',
            isPrimary: b.isPrimary,
          })),

          users: m.users.map<User>((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role as User['role'],
            avatarColor: colorFor(u.id),
            branchId: u.branchId ?? '',
            branchAccess: u.branchAccess,
          })),

        });

        setNext(m.nextInvoiceNumber);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load master data.');
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { ready, error, nextInvoiceNumber };
}
