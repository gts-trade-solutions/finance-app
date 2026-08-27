// ─────────────────────────────────────────────────────────────────────────────
// Banking services — imports, rules, matching, transfers, cheques.
// ─────────────────────────────────────────────────────────────────────────────

import { getState, setState } from '../store';
import { buildEntry, genId } from '../ledger/posting';
import { logAudit } from './audit';
import type { Account, BankAccount, BankRule, BankTxn, Cheque } from '../types';
import { ACC } from '../mock/seed/accounts';

function nextEntryNo(): number {
  const n = getState().nextEntryNo;
  setState({ nextEntryNo: n + 1 });
  return n;
}

function currentUserId(): string {
  return getState().session?.userId ?? 'system';
}

/** Import parsed statement rows; dedupes on (account, date, amount, narration). */
export function importBankTxns(
  bankAccountId: string,
  rows: { date: string; amountPaise: number; direction: 'in' | 'out'; narration: string; reference?: string }[],
  batchLabel: string,
): { imported: number; duplicates: number } {
  const s = getState();
  const existingKeys = new Set(
    s.bankTxns.map((t) => `${t.bankAccountId}|${t.date}|${t.amountPaise}|${t.direction}|${t.narration}`),
  );
  const fresh: BankTxn[] = [];
  let duplicates = 0;
  for (const r of rows) {
    const key = `${bankAccountId}|${r.date}|${r.amountPaise}|${r.direction}|${r.narration}`;
    if (existingKeys.has(key)) {
      duplicates += 1;
      continue;
    }
    existingKeys.add(key);
    fresh.push({
      id: genId('btxn'),
      bankAccountId,
      date: r.date,
      amountPaise: r.amountPaise,
      direction: r.direction,
      narration: r.narration,
      reference: r.reference ?? '',
      status: 'unmatched',
      importBatch: batchLabel,
    });
  }
  setState({ bankTxns: [...fresh, ...s.bankTxns] });
  logAudit('create', 'bank_import', batchLabel, batchLabel, `${fresh.length} lines imported, ${duplicates} duplicates skipped`);
  return { imported: fresh.length, duplicates };
}

/** Run active rules over unmatched lines; returns ids of lines auto-categorized. */
export function applyBankRules(bankAccountId?: string): string[] {
  const s = getState();
  const rules = [...s.bankRules].filter((r) => r.isActive).sort((a, b) => a.priority - b.priority);
  const hits: string[] = [];
  const updated = s.bankTxns.map((t) => {
    if (t.status !== 'unmatched') return t;
    if (bankAccountId && t.bankAccountId !== bankAccountId) return t;
    for (const rule of rules) {
      if (ruleMatches(rule, t)) {
        hits.push(t.id);
        return {
          ...t,
          status: (rule.autoConfirm ? 'matched' : t.status) as BankTxn['status'],
          matchedTo: rule.autoConfirm
            ? { type: 'journal' as const, id: rule.id, label: `Rule: ${rule.name}` }
            : t.matchedTo,
        };
      }
    }
    return t;
  });
  setState({ bankTxns: updated });
  return hits;
}

export function ruleMatches(rule: BankRule, t: BankTxn): boolean {
  return rule.conditions.every((c) => {
    if (c.field === 'narration') {
      if (c.op === 'contains') return t.narration.toLowerCase().includes(c.value.toLowerCase());
      if (c.op === 'equals') return t.narration.toLowerCase() === c.value.toLowerCase();
    }
    if (c.field === 'amount') {
      const v = Math.round(parseFloat(c.value) * 100);
      if (c.op === 'equals') return t.amountPaise === v;
      if (c.op === 'gt') return t.amountPaise > v;
      if (c.op === 'lt') return t.amountPaise < v;
    }
    if (c.field === 'direction') return t.direction === c.value;
    return false;
  });
}

/** Match a bank line to an existing payment/expense (no new posting needed). */
export function matchBankTxn(
  txnId: string,
  target: { type: 'payment' | 'expense' | 'transfer' | 'journal'; id: string; label: string },
): void {
  setState({
    bankTxns: getState().bankTxns.map((t) =>
      t.id === txnId ? { ...t, status: 'matched', matchedTo: target } : t,
    ),
  });
  const t = getState().bankTxns.find((x) => x.id === txnId);
  if (t) logAudit('match', 'bank_txn', txnId, t.narration.slice(0, 40), `Matched to ${target.label}`);
}

export function unmatchBankTxn(txnId: string): void {
  setState({
    bankTxns: getState().bankTxns.map((t) =>
      t.id === txnId ? { ...t, status: 'unmatched', matchedTo: undefined } : t,
    ),
  });
}

export function excludeBankTxn(txnId: string): void {
  setState({
    bankTxns: getState().bankTxns.map((t) => (t.id === txnId ? { ...t, status: 'excluded' } : t)),
  });
}

/** Transfer between own accounts — posts DR destination / CR source. */
export function createTransfer(input: {
  fromBankAccountId: string;
  toBankAccountId: string;
  date: string;
  amountPaise: number;
  memo?: string;
}): string {
  const s = getState();
  const from = s.bankAccounts.find((b) => b.id === input.fromBankAccountId)!;
  const to = s.bankAccounts.find((b) => b.id === input.toBankAccountId)!;
  const entry = buildEntry({
    entryNo: nextEntryNo(),
    date: input.date,
    sourceType: 'transfer',
    sourceId: null,
    memo: input.memo ?? `Transfer ${from.name} → ${to.name}`,
    lines: [
      { accountId: to.ledgerAccountId, debit: input.amountPaise },
      { accountId: from.ledgerAccountId, credit: input.amountPaise },
    ],
    createdBy: currentUserId(),
  });
  setState({ entries: [...s.entries, entry] });
  logAudit('create', 'transfer', entry.id, entry.memo, `₹${(input.amountPaise / 100).toLocaleString('en-IN')}`);
  return entry.id;
}

export function addCheque(c: Omit<Cheque, 'id'>): Cheque {
  const cheque: Cheque = { ...c, id: genId('chq') };
  setState({ cheques: [cheque, ...getState().cheques] });
  logAudit('create', 'cheque', cheque.id, cheque.chequeNo, `${c.kind} cheque ₹${(c.amountPaise / 100).toLocaleString('en-IN')}${c.isPdc ? ' (PDC)' : ''}`);
  return cheque;
}

export function setChequeStatus(id: string, status: Cheque['status']): void {
  setState({
    cheques: getState().cheques.map((c) => (c.id === id ? { ...c, status } : c)),
  });
  const c = getState().cheques.find((x) => x.id === id);
  if (c) logAudit('update', 'cheque', id, c.chequeNo, `Status → ${status}`);
}


// ─────────────────────────────────────────────────────────────────────────────
// Add Bank or Credit Card
//
// An account in the banking screen is only half the picture — it also needs a
// ledger account, or nothing it does can be posted. Creating one here creates
// both, and an opening balance posts a real balanced entry rather than being
// stored as a loose number.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateBankAccountInput {
  kind: BankAccount['kind'];
  name: string;
  bankName?: string;
  accountNumber?: string;
  ifsc?: string;
  openingBalancePaise?: number;
  openingDate?: string;
  isPrimary?: boolean;
  feedConnected?: boolean;
}

/** Next free code in the right block, so the chart of accounts stays ordered. */
function nextAccountCode(accounts: Account[], kind: BankAccount['kind']): string {
  const base = kind === 'card' ? 2500 : kind === 'cash' ? 1290 : kind === 'clearing' ? 1250 : 1210;
  const used = new Set(accounts.map((a) => a.code));
  let code = base;
  while (used.has(String(code))) code += 1;
  return String(code);
}

export function createBankAccount(input: CreateBankAccountInput): BankAccount {
  const s = getState();

  // A credit card is money owed, so its ledger account is a liability.
  const isCard = input.kind === 'card';
  const ledger: Account = {
    id: genId('acc'),
    code: nextAccountCode(s.accounts, input.kind),
    name: input.name,
    type: isCard ? 'liability' : 'asset',
    parentId: null,
    isSystem: false,
    isArchived: false,
    description: input.bankName ? `${input.bankName} — added from Banking` : undefined,
  };

  const account: BankAccount = {
    id: genId('ba'),
    kind: input.kind,
    name: input.name,
    bankName: input.bankName,
    accountNumber: input.accountNumber,
    accountLast4: input.accountNumber?.slice(-4),
    ifsc: input.ifsc,
    ledgerAccountId: ledger.id,
    openingBalancePaise: input.openingBalancePaise ?? 0,
    feedConnected: input.feedConnected ?? false,
    isPrimary: input.isPrimary,
    currency: 'INR',
    isArchived: false,
  };

  setState({
    accounts: [...s.accounts, ledger],
    bankAccounts: [...s.bankAccounts, account],
  });

  const opening = input.openingBalancePaise ?? 0;
  if (opening !== 0) {
    // The other side is owner's capital — this money existed before the books
    // started, so it is not income.
    const entry = buildEntry({
      entryNo: nextEntryNo(),
      date: input.openingDate ?? new Date().toISOString().slice(0, 10),
      sourceType: 'opening',
      sourceId: account.id,
      memo: `Opening balance — ${account.name}`,
      lines: isCard
        ? [
            { accountId: ACC.CAPITAL, debit: opening },
            { accountId: ledger.id, credit: opening },
          ]
        : [
            { accountId: ledger.id, debit: opening },
            { accountId: ACC.CAPITAL, credit: opening },
          ],
      createdBy: currentUserId(),
    });
    setState({ entries: [...getState().entries, entry] });
  }

  logAudit(
    'create',
    'bank_account',
    account.id,
    account.name,
    `${input.kind} account added${opening ? ` with opening balance ₹${(opening / 100).toLocaleString('en-IN')}` : ''}`,
  );
  return account;
}
