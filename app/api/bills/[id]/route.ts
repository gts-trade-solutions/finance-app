import { z } from 'zod';
import { db, transaction } from '@/lib/server/db';
import { route, body, idParam, asId, notFound } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';
import { voidBill, postBill } from '@/lib/server/services/purchases';
import { logAudit, auditMeta } from '@/lib/server/audit';

/** One bill with its lines, payments and the journal entry behind it. */
export const GET = route(
  async ({ orgId, params }) => {
    const id = idParam(params);

    const bill = await db
      .selectFrom('bills')
      .innerJoin('contacts', 'contacts.id', 'bills.vendor_id')
      .innerJoin('branches', 'branches.id', 'bills.branch_id')
      .select([
        'bills.id', 'bills.internal_no', 'bills.vendor_invoice_no', 'bills.bill_date',
        'bills.due_date', 'bills.status', 'bills.is_rcm', 'bills.place_of_supply',
        'bills.supply_type', 'bills.subtotal', 'bills.cgst', 'bills.sgst', 'bills.igst',
        'bills.cess', 'bills.tds_amount', 'bills.tds_section', 'bills.round_off',
        'bills.total', 'bills.amount_paid', 'bills.notes', 'bills.journal_entry_id',
        'bills.vendor_id', 'bills.branch_id', 'bills.created_at',
        'contacts.display_name as vendor_name', 'contacts.gstin as vendor_gstin',
        'contacts.is_msme', 'contacts.billing_address as vendor_address',
        'branches.name as branch_name', 'branches.gstin as branch_gstin',
      ])
      .where('bills.id', '=', id)
      .where('bills.org_id', '=', orgId)
      .executeTakeFirst();

    if (!bill) throw notFound('Bill not found.');

    const [lines, payments, entry] = await Promise.all([
      db
        .selectFrom('bill_lines')
        .leftJoin('accounts', 'accounts.id', 'bill_lines.account_id')
        .select([
          'bill_lines.id', 'bill_lines.line_no', 'bill_lines.item_id', 'bill_lines.description',
          'bill_lines.hsn_sac', 'bill_lines.qty', 'bill_lines.uqc', 'bill_lines.rate',
          'bill_lines.discount_pct', 'bill_lines.gst_rate_pct', 'bill_lines.taxable',
          'bill_lines.cgst', 'bill_lines.sgst', 'bill_lines.igst', 'bill_lines.line_total',
          'bill_lines.itc_eligibility', 'accounts.name as account_name',
        ])
        .where('bill_lines.bill_id', '=', id)
        .orderBy('bill_lines.line_no')
        .execute(),
      db
        .selectFrom('payment_allocations')
        .innerJoin('payments', 'payments.id', 'payment_allocations.payment_id')
        .select([
          'payments.id', 'payments.number', 'payments.payment_date', 'payments.mode',
          'payment_allocations.amount',
        ])
        .where('payment_allocations.target_type', '=', 'bill')
        .where('payment_allocations.target_id', '=', id)
        .where('payments.status', '<>', 'void')
        .execute(),
      bill.journal_entry_id
        ? db
            .selectFrom('journal_lines')
            .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
            .select([
              'journal_lines.line_no', 'journal_lines.debit', 'journal_lines.credit',
              'journal_lines.description', 'accounts.code', 'accounts.name',
            ])
            .where('journal_lines.entry_id', '=', bill.journal_entry_id)
            .orderBy('journal_lines.line_no')
            .execute()
        : Promise.resolve([]),
    ]);

    const p = toPaiseFromSql;
    return {
      id: asId(bill.id),
      internalNo: bill.internal_no,
      vendorInvoiceNo: bill.vendor_invoice_no,
      date: bill.bill_date,
      dueDate: bill.due_date,
      status: bill.status,
      isRcm: !!bill.is_rcm,
      placeOfSupply: bill.place_of_supply,
      supplyType: bill.supply_type,
      vendor: {
        id: asId(bill.vendor_id),
        name: bill.vendor_name,
        gstin: bill.vendor_gstin,
        address: bill.vendor_address,
        isMsme: !!bill.is_msme,
      },
      branch: { id: asId(bill.branch_id), name: bill.branch_name, gstin: bill.branch_gstin },
      notes: bill.notes,
      subtotalPaise: p(bill.subtotal),
      tax: { cgstPaise: p(bill.cgst), sgstPaise: p(bill.sgst), igstPaise: p(bill.igst), cessPaise: p(bill.cess) },
      tdsPaise: p(bill.tds_amount),
      tdsSection: bill.tds_section,
      roundOffPaise: p(bill.round_off),
      totalPaise: p(bill.total),
      amountPaidPaise: p(bill.amount_paid),
      // A void bill is cancelled: the document remains, the obligation does not.
      balancePaise: bill.status === 'void' ? 0 : p(bill.total) - p(bill.amount_paid),
      createdAt: bill.created_at,
      lines: lines.map((l) => ({
        id: asId(l.id),
        itemId: l.item_id ? asId(l.item_id) : null,
        accountName: l.account_name,
        description: l.description,
        hsnSac: l.hsn_sac,
        qty: Number(l.qty),
        uqc: l.uqc,
        ratePaise: p(l.rate),
        discountPct: Number(l.discount_pct),
        gstRatePct: Number(l.gst_rate_pct),
        taxablePaise: p(l.taxable),
        cgstPaise: p(l.cgst),
        sgstPaise: p(l.sgst),
        igstPaise: p(l.igst),
        totalPaise: p(l.line_total),
        itcEligibility: l.itc_eligibility,
      })),
      payments: payments.map((pay) => ({
        id: asId(pay.id),
        number: pay.number,
        date: pay.payment_date,
        mode: pay.mode,
        amountPaise: p(pay.amount),
      })),
      journalEntryId: bill.journal_entry_id ? asId(bill.journal_entry_id) : null,
      journalLines: entry.map((l) => ({
        lineNo: l.line_no,
        accountCode: l.code,
        accountName: l.name,
        debitPaise: p(l.debit),
        creditPaise: p(l.credit),
        description: l.description,
      })),
    };
  },
  { permission: { module: 'purchases', action: 'view' } },
);

const ActionInput = z.object({
  action: z.enum(['post', 'void']),
  reason: z.string().max(300).optional(),
});

export const POST = route(
  async ({ orgId, user, req, params }) => {
    const id = idParam(params);
    const { action, reason } = await body(req, ActionInput);

    await transaction(async (trx) => {
      if (action === 'post') await postBill(trx, orgId, user.userId, id);
      else await voidBill(trx, orgId, user.userId, id, reason);
    });

    const bill = await db
      .selectFrom('bills').select(['internal_no', 'status'])
      .where('id', '=', id).executeTakeFirstOrThrow();

    await logAudit({
      orgId,
      actorUserId: user.userId,
      actorName: user.name,
      action: action === 'void' ? 'void' : 'approve',
      targetType: 'bill',
      targetId: id,
      targetLabel: bill.internal_no,
      detail: action === 'void'
        ? `Voided bill ${bill.internal_no}${reason ? ` — ${reason}` : ''}`
        : `Posted bill ${bill.internal_no}`,
      ...auditMeta(req),
    });

    return { id: asId(id), status: bill.status };
  },
  { permission: { module: 'purchases', action: 'edit' } },
);
