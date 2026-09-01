import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// Payments received and made, and the allocations that tie them to documents.
//
// A payment is stored separately from what it settles, because the two are
// genuinely independent: one receipt can clear three invoices and leave change
// on account, and one payment run can settle twenty bills. Storing the link on
// the invoice instead would make both impossible to record honestly.
//
// Money that arrives without a document to match is not lost — it becomes an
// advance, a liability, and sits in `unapplied_amount` until somebody applies
// it. Forcing every receipt to name an invoice is how customers' overpayments
// end up quietly absorbed into whichever invoice was nearest.
// ─────────────────────────────────────────────────────────────────────────────

import type { Trx } from '../db';
import type { Paise } from '../../types';
import { toPaiseFromSql, toSqlFromPaise } from '../money-sql';
import { allocateOrgNumber, postEntry, reverseEntry, type DraftLine } from '../ledger/posting';
import { CODE, accountIds, requireAccount } from '../ledger/chart-of-accounts';
import { ApiError, badRequest, notFound } from '../http';
import { fyLabelFor } from './sales';

export type PaymentMode =
  | 'cash' | 'cheque' | 'neft' | 'rtgs' | 'imps' | 'upi' | 'card' | 'netbanking' | 'other';

export type AllocationTarget = 'invoice' | 'bill' | 'credit_note' | 'vendor_credit' | 'retainer';

export interface AllocationInput {
  targetType: AllocationTarget;
  targetId: number;
  amountPaise: Paise;
}

export interface RecordPaymentInput {
  branchId: number;
  contactId: number;
  date: string;
  mode: PaymentMode;
  /** Gross: what the party parted with, before any TDS they withheld. */
  amountPaise: Paise;
  bankAccountId: number;
  reference?: string | null;
  tdsPaise?: Paise;
  bankChargesPaise?: Paise;
  allocations?: AllocationInput[];
  notes?: string | null;
}

/**
 * Record money received from a customer.
 *
 *   Dr Bank            what actually landed
 *   Dr TDS receivable  what the customer withheld and paid on our behalf
 *   Dr Bank charges    deducted in transit, if any
 *     Cr Accounts receivable   the invoice balance cleared
 *
 * TDS never reaches the bank, so it cannot be netted into the amount — but it
 * does settle the invoice, because the customer has discharged that much of
 * their debt by paying the government instead of us.
 */
export async function receivePayment(
  trx: Trx,
  orgId: number,
  userId: number | null,
  input: RecordPaymentInput,
): Promise<{ id: number; number: string; unappliedPaise: Paise; journalEntryId: number }> {
  return recordPayment(trx, orgId, userId, input, 'received');
}

/** Record money paid to a vendor. The mirror image of a receipt. */
export async function makePayment(
  trx: Trx,
  orgId: number,
  userId: number | null,
  input: RecordPaymentInput,
): Promise<{ id: number; number: string; unappliedPaise: Paise; journalEntryId: number }> {
  return recordPayment(trx, orgId, userId, input, 'made');
}

async function recordPayment(
  trx: Trx,
  orgId: number,
  userId: number | null,
  input: RecordPaymentInput,
  kind: 'received' | 'made',
): Promise<{ id: number; number: string; unappliedPaise: Paise; journalEntryId: number }> {
  if (input.amountPaise <= 0) throw badRequest('A payment needs an amount above zero.');

  const contact = await trx
    .selectFrom('contacts').select(['id', 'display_name'])
    .where('id', '=', input.contactId).where('org_id', '=', orgId).executeTakeFirst();
  if (!contact) throw notFound('That contact does not exist.');

  const bank = await trx
    .selectFrom('bank_accounts').select(['id', 'name', 'ledger_account_id'])
    .where('id', '=', input.bankAccountId).where('org_id', '=', orgId).executeTakeFirst();
  if (!bank) throw notFound('That account does not exist.');

  const tds = input.tdsPaise ?? 0;
  const charges = input.bankChargesPaise ?? 0;
  const allocations = input.allocations ?? [];

  // The settling power of a receipt is the cash plus the TDS: both reduce what
  // the customer owes, even though only one of them reaches the bank.
  const settles = input.amountPaise + tds;
  const allocated = allocations.reduce((t, a) => t + a.amountPaise, 0);

  if (allocated > settles) {
    throw badRequest(
      `You have allocated ${(allocated / 100).toFixed(2)} against a payment worth ` +
        `${(settles / 100).toFixed(2)}. Reduce the allocation, or increase the payment.`,
    );
  }
  for (const a of allocations) {
    if (a.amountPaise <= 0) throw badRequest('An allocation must be for more than zero.');
  }

  const unapplied = settles - allocated;

  // Org-wide, matching uq_pay_org_number. A receipt is an internal document;
  // unlike an invoice it carries no per-registration numbering obligation.
  const prefix = kind === 'received' ? 'RCPT' : 'PAY';
  const number = await allocateOrgNumber(trx, orgId, prefix, fyLabelFor(input.date), prefix);

  const inserted = await trx
    .insertInto('payments')
    .values({
      org_id: orgId,
      branch_id: input.branchId,
      number,
      kind,
      contact_id: input.contactId,
      payment_date: input.date,
      mode: input.mode,
      amount: toSqlFromPaise(input.amountPaise),
      bank_account_id: input.bankAccountId,
      reference: input.reference ?? null,
      tds_amount: toSqlFromPaise(tds),
      bank_charges: toSqlFromPaise(charges),
      unapplied_amount: toSqlFromPaise(unapplied),
      status: 'cleared',
      notes: input.notes ?? null,
      created_by_user_id: userId,
    })
    .executeTakeFirstOrThrow();
  const paymentId = Number(inserted.insertId);

  if (allocations.length) {
    await trx
      .insertInto('payment_allocations')
      .values(
        allocations.map((a) => ({
          org_id: orgId,
          payment_id: paymentId,
          target_type: a.targetType,
          target_id: a.targetId,
          amount: toSqlFromPaise(a.amountPaise),
        })),
      )
      .execute();

    await applyAllocations(trx, orgId, allocations, +1);
  }

  const acc = await accountIds(trx, orgId);
  const draft: DraftLine[] = [];

  if (kind === 'received') {
    draft.push({
      accountId: bank.ledger_account_id,
      debit: input.amountPaise - charges,
      description: `Received from ${contact.display_name}`,
    });
    if (charges > 0) draft.push({ accountId: requireAccount(acc, CODE.BANK_CHARGES), debit: charges });
    if (tds > 0) {
      draft.push({
        accountId: requireAccount(acc, CODE.TDS_RECEIVABLE),
        debit: tds,
        description: 'TDS deducted by customer',
      });
    }
    draft.push({
      accountId: requireAccount(acc, CODE.AR),
      credit: settles,
      contactId: input.contactId,
      description: number,
    });
  } else {
    draft.push({
      accountId: requireAccount(acc, CODE.AP),
      debit: settles,
      contactId: input.contactId,
      description: number,
    });
    if (tds > 0) {
      // TDS we withheld is not paid to the vendor; it is owed to the government.
      draft.push({
        accountId: requireAccount(acc, CODE.TDS_PAYABLE),
        credit: tds,
        description: 'TDS withheld on payment',
      });
    }
    if (charges > 0) draft.push({ accountId: requireAccount(acc, CODE.BANK_CHARGES), debit: charges });
    draft.push({
      accountId: bank.ledger_account_id,
      credit: input.amountPaise + charges,
      description: `Paid to ${contact.display_name}`,
    });
  }

  const entry = await postEntry(trx, {
    orgId,
    branchId: input.branchId,
    date: input.date,
    memo: `${kind === 'received' ? 'Receipt' : 'Payment'} ${number} — ${contact.display_name}`,
    sourceType: kind === 'received' ? 'payment_received' : 'payment_made',
    sourceId: paymentId,
    userId,
    module: kind === 'received' ? 'sales' : 'purchases',
    lines: draft,
  });

  await trx
    .updateTable('payments').set({ journal_entry_id: entry.id })
    .where('id', '=', paymentId).execute();

  return { id: paymentId, number, unappliedPaise: unapplied, journalEntryId: entry.id };
}

/**
 * Move each target's paid figure and recompute its status.
 *
 * `direction` is +1 when applying and -1 when a payment is reversed, so the
 * same code undoes what it did rather than a second near-copy of it drifting.
 */
async function applyAllocations(
  trx: Trx,
  orgId: number,
  allocations: AllocationInput[],
  direction: 1 | -1,
): Promise<void> {
  for (const a of allocations) {
    const delta = a.amountPaise * direction;

    if (a.targetType === 'invoice') {
      const inv = await trx
        .selectFrom('invoices').select(['id', 'total', 'amount_paid', 'status', 'due_date'])
        .where('id', '=', a.targetId).where('org_id', '=', orgId).forUpdate().executeTakeFirst();
      if (!inv) throw notFound(`Invoice ${a.targetId} not found.`);

      const paid = toPaiseFromSql(inv.amount_paid) + delta;
      const total = toPaiseFromSql(inv.total);
      if (paid > total) {
        throw new ApiError(
          409,
          `That would allocate more than invoice ${a.targetId} is worth. ` +
            'Leave the extra on account instead — it stays available for the next invoice.',
          'over_allocated',
        );
      }

      await trx
        .updateTable('invoices')
        .set({
          amount_paid: toSqlFromPaise(paid),
          status: paid >= total ? 'paid' : paid > 0 ? 'partially_paid' : 'sent',
        })
        .where('id', '=', a.targetId)
        .execute();
    } else if (a.targetType === 'bill') {
      const bill = await trx
        .selectFrom('bills').select(['id', 'total', 'amount_paid', 'status'])
        .where('id', '=', a.targetId).where('org_id', '=', orgId).forUpdate().executeTakeFirst();
      if (!bill) throw notFound(`Bill ${a.targetId} not found.`);

      const paid = toPaiseFromSql(bill.amount_paid) + delta;
      const total = toPaiseFromSql(bill.total);
      if (paid > total) {
        throw new ApiError(409, `That would pay more than bill ${a.targetId} is worth.`, 'over_allocated');
      }

      await trx
        .updateTable('bills')
        .set({
          amount_paid: toSqlFromPaise(paid),
          status: paid >= total ? 'paid' : paid > 0 ? 'partially_paid' : 'open',
        })
        .where('id', '=', a.targetId)
        .execute();
    } else if (a.targetType === 'retainer') {
      // Receiving money against a retainer settles the receivable. It does not
      // spend the advance — that happens later, when work is invoiced and the
      // retainer is applied against it. Two different columns, deliberately.
      const r = await trx
        .selectFrom('retainer_invoices').select(['id', 'amount', 'amount_paid', 'applied_amount'])
        .where('id', '=', a.targetId).where('org_id', '=', orgId).forUpdate().executeTakeFirst();
      if (!r) throw notFound(`Retainer ${a.targetId} not found.`);

      const total = toPaiseFromSql(r.amount);
      const paid = toPaiseFromSql(r.amount_paid) + delta;
      if (paid > total) {
        throw new ApiError(
          409,
          `That would collect more than retainer ${a.targetId} is worth. ` +
            'Leave the extra on account instead.',
          'over_allocated',
        );
      }
      const applied = toPaiseFromSql(r.applied_amount);

      await trx
        .updateTable('retainer_invoices')
        .set({
          amount_paid: toSqlFromPaise(paid),
          status:
            applied >= total ? 'applied'
            : applied > 0 ? 'partially_applied'
            : paid >= total ? 'paid'
            : 'sent',
        })
        .where('id', '=', a.targetId)
        .execute();
    }
  }
}

/**
 * Void a payment: reverse its entry and give back what it had settled.
 *
 * The invoices it paid go back to being unpaid, which is the part that is easy
 * to forget — a reversed receipt that leaves an invoice marked paid is money
 * nobody will ever chase.
 */
export async function voidPayment(
  trx: Trx,
  orgId: number,
  userId: number | null,
  paymentId: number,
  reason?: string,
): Promise<void> {
  const payment = await trx
    .selectFrom('payments').select(['id', 'number', 'kind', 'status', 'journal_entry_id'])
    .where('id', '=', paymentId).where('org_id', '=', orgId).executeTakeFirst();
  if (!payment) throw notFound('Payment not found.');
  if (payment.status === 'void') throw new ApiError(409, 'That payment is already void.', 'conflict');

  const allocations = await trx
    .selectFrom('payment_allocations')
    .select(['target_type', 'target_id', 'amount'])
    .where('payment_id', '=', paymentId)
    .execute();

  await applyAllocations(
    trx,
    orgId,
    allocations.map((a) => ({
      targetType: a.target_type as AllocationTarget,
      targetId: a.target_id,
      amountPaise: toPaiseFromSql(a.amount),
    })),
    -1,
  );

  if (payment.journal_entry_id) {
    await reverseEntry(trx, orgId, payment.journal_entry_id, {
      memo: `Void of ${payment.number}${reason ? ` — ${reason}` : ''}`,
      userId,
      module: payment.kind === 'received' ? 'sales' : 'purchases',
    });
  }

  await trx.updateTable('payments').set({ status: 'void' }).where('id', '=', paymentId).execute();
}
