import { z } from 'zod';
import { db, transaction } from '@/lib/server/db';
import { route, body, idParam, asId, notFound } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';
import { markInvoiceSent, voidInvoice } from '@/lib/server/services/sales';
import { logAudit, auditMeta } from '@/lib/server/audit';

/** One invoice with its lines, its payments, and the journal entry behind it. */
export const GET = route(
  async ({ orgId, params }) => {
    const id = idParam(params);

    const inv = await db
      .selectFrom('invoices')
      .innerJoin('contacts', 'contacts.id', 'invoices.customer_id')
      .innerJoin('branches', 'branches.id', 'invoices.branch_id')
      .select([
        'invoices.id', 'invoices.number', 'invoices.invoice_date', 'invoices.due_date',
        'invoices.status', 'invoices.place_of_supply', 'invoices.supply_type',
        'invoices.supply_kind', 'invoices.subtotal', 'invoices.cgst', 'invoices.sgst',
        'invoices.igst', 'invoices.cess', 'invoices.tcs', 'invoices.shipping_charge',
        'invoices.adjustment', 'invoices.adjustment_label', 'invoices.round_off',
        'invoices.total', 'invoices.amount_paid', 'invoices.order_number',
        'invoices.subject', 'invoices.payment_terms', 'invoices.notes', 'invoices.terms',
        'invoices.journal_entry_id', 'invoices.customer_id', 'invoices.branch_id',
        'invoices.created_at',
        'contacts.display_name as customer_name', 'contacts.gstin as customer_gstin',
        'contacts.billing_address as customer_address',
        'branches.name as branch_name', 'branches.gstin as branch_gstin',
      ])
      .where('invoices.id', '=', id)
      .where('invoices.org_id', '=', orgId)
      .executeTakeFirst();

    if (!inv) throw notFound('Invoice not found.');

    const [lines, mark, payments, entry] = await Promise.all([
      db.selectFrom('invoice_lines').selectAll().where('invoice_id', '=', id).orderBy('line_no').execute(),
      db.selectFrom('einvoices').selectAll().where('invoice_id', '=', id).executeTakeFirst(),
      db
        .selectFrom('payment_allocations')
        .innerJoin('payments', 'payments.id', 'payment_allocations.payment_id')
        .select([
          'payments.id', 'payments.number', 'payments.payment_date', 'payments.mode',
          'payment_allocations.amount',
        ])
        .where('payment_allocations.target_type', '=', 'invoice')
        .where('payment_allocations.target_id', '=', id)
        .where('payments.status', '<>', 'void')
        .execute(),
      inv.journal_entry_id
        ? db
            .selectFrom('journal_lines')
            .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
            .select([
              'journal_lines.line_no', 'journal_lines.debit', 'journal_lines.credit',
              'journal_lines.description', 'accounts.code', 'accounts.name',
            ])
            .where('journal_lines.entry_id', '=', inv.journal_entry_id)
            .orderBy('journal_lines.line_no')
            .execute()
        : Promise.resolve([]),
    ]);

    const p = toPaiseFromSql;
    return {
      id: asId(inv.id),
      number: inv.number,
      date: inv.invoice_date,
      dueDate: inv.due_date,
      status: inv.status,
      placeOfSupply: inv.place_of_supply,
      supplyType: inv.supply_type,
      supplyKind: inv.supply_kind,
      customer: {
        id: asId(inv.customer_id),
        name: inv.customer_name,
        gstin: inv.customer_gstin,
        address: inv.customer_address,
      },
      branch: { id: asId(inv.branch_id), name: inv.branch_name, gstin: inv.branch_gstin },
      orderNumber: inv.order_number,
      subject: inv.subject,
      paymentTerms: inv.payment_terms,
      notes: inv.notes,
      terms: inv.terms,
      subtotalPaise: p(inv.subtotal),
      tax: { cgstPaise: p(inv.cgst), sgstPaise: p(inv.sgst), igstPaise: p(inv.igst), cessPaise: p(inv.cess) },
      tcsPaise: p(inv.tcs),
      shippingChargePaise: p(inv.shipping_charge),
      adjustmentPaise: p(inv.adjustment),
      adjustmentLabel: inv.adjustment_label,
      roundOffPaise: p(inv.round_off),
      totalPaise: p(inv.total),
      amountPaidPaise: p(inv.amount_paid),
      balancePaise: p(inv.total) - p(inv.amount_paid),
      createdAt: inv.created_at,
      lines: lines.map((l) => ({
        id: asId(l.id),
        itemId: l.item_id ? asId(l.item_id) : null,
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
      })),
      einvoice: mark
        ? { status: mark.status, irn: mark.irn, ackNo: mark.ack_no, ackDate: mark.ack_date }
        : { status: 'not_applicable', irn: null },
      payments: payments.map((pay) => ({
        id: asId(pay.id),
        number: pay.number,
        date: pay.payment_date,
        mode: pay.mode,
        amountPaise: p(pay.amount),
      })),
      // The proof: what this document did to the books.
      journalEntryId: inv.journal_entry_id ? asId(inv.journal_entry_id) : null,
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
  { permission: { module: 'sales', action: 'view' } },
);

const ActionInput = z.object({
  action: z.enum(['send', 'void']),
  reason: z.string().max(300).optional(),
});

/**
 * State changes on an existing invoice.
 *
 * There is no PUT that rewrites a posted invoice. Editing one that is already
 * in the ledger and reported to the customer would change history silently;
 * the routes here are the transitions that leave a trail.
 */
export const POST = route(
  async ({ orgId, user, req, params }) => {
    const id = idParam(params);
    const { action, reason } = await body(req, ActionInput);

    await transaction(async (trx) => {
      if (action === 'send') await markInvoiceSent(trx, orgId, user.userId, id);
      else await voidInvoice(trx, orgId, user.userId, id, reason);
    });

    const inv = await db
      .selectFrom('invoices').select(['number', 'status'])
      .where('id', '=', id).executeTakeFirstOrThrow();

    await logAudit({
      orgId,
      actorUserId: user.userId,
      actorName: user.name,
      action: action === 'void' ? 'void' : 'send',
      targetType: 'invoice',
      targetId: id,
      targetLabel: inv.number,
      detail: action === 'void'
        ? `Voided invoice ${inv.number}${reason ? ` — ${reason}` : ''}`
        : `Sent invoice ${inv.number}`,
      ...auditMeta(req),
    });

    return { id: asId(id), status: inv.status };
  },
  { permission: { module: 'sales', action: 'edit' } },
);
