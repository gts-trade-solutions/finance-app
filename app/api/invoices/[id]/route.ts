import { z } from 'zod';
import { db, transaction } from '@/lib/server/db';
import { route, body, idParam, asId, notFound } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';
import { markInvoiceSent, voidInvoice } from '@/lib/server/services/sales';
import { logAudit, auditMeta } from '@/lib/server/audit';
import { environmentOf } from '@/lib/server/integrations/gst';
import { irnCancelOpenUntil } from '@/lib/tax/einvoice';
import { queuedRetries } from '@/lib/server/jobs/queue';

/** One invoice with its lines, its payments, and the journal entry behind it. */
export const GET = route(
  async ({ orgId, params }) => {
    const id = idParam(params);

    const inv = await db
      .selectFrom('invoices')
      .innerJoin('contacts', 'contacts.id', 'invoices.customer_id')
      .innerJoin('branches', 'branches.id', 'invoices.branch_id')
      .innerJoin('organizations', 'organizations.id', 'invoices.org_id')
      .select([
        'invoices.id', 'invoices.number', 'invoices.invoice_date', 'invoices.due_date',
        'invoices.status', 'invoices.place_of_supply', 'invoices.supply_type',
        'invoices.supply_kind', 'invoices.subtotal', 'invoices.cgst', 'invoices.sgst',
        'invoices.igst', 'invoices.cess', 'invoices.tcs', 'invoices.shipping_charge',
        'invoices.adjustment', 'invoices.adjustment_label', 'invoices.round_off',
        'invoices.total', 'invoices.amount_paid', 'invoices.order_number',
        'invoices.subject', 'invoices.payment_terms', 'invoices.notes', 'invoices.terms',
        'invoices.journal_entry_id', 'invoices.customer_id', 'invoices.branch_id',
        'invoices.created_at', 'invoices.eway_bill_no',
        'contacts.display_name as customer_name', 'contacts.gstin as customer_gstin',
        'contacts.billing_address as customer_address',
        // The rest is what Rule 46 asks a tax invoice to carry.
        'contacts.legal_name as customer_legal_name', 'contacts.state_code as customer_state',
        'contacts.billing_city as customer_city', 'contacts.billing_pincode as customer_pincode',
        'contacts.shipping_address as ship_address', 'contacts.shipping_city as ship_city',
        'contacts.shipping_pincode as ship_pincode', 'contacts.gst_treatment as customer_treatment',
        'branches.name as branch_name', 'branches.gstin as branch_gstin',
        'branches.address as branch_address', 'branches.city as branch_city',
        'branches.pincode as branch_pincode', 'branches.state_code as branch_state',
        'organizations.name as org_name', 'organizations.legal_name as org_legal_name',
        'organizations.pan as org_pan', 'organizations.email as org_email',
        'organizations.phone as org_phone', 'organizations.gst_registration_type as org_registration',
      ])
      .where('invoices.id', '=', id)
      .where('invoices.org_id', '=', orgId)
      .executeTakeFirst();

    if (!inv) throw notFound('Invoice not found.');

    const [lines, mark, payments, entry, ewb] = await Promise.all([
      // A line picked from the catalogue stores the item, not its words; the
      // item's name stands in so no document shows a line with no description.
      db
        .selectFrom('invoice_lines')
        .leftJoin('items', 'items.id', 'invoice_lines.item_id')
        .selectAll('invoice_lines')
        .select('items.name as item_name')
        .where('invoice_lines.invoice_id', '=', id)
        .orderBy('invoice_lines.line_no')
        .execute(),
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
      // An expired bill still names the movement the goods made, so it prints.
      db
        .selectFrom('eway_bills')
        .select(['eway_bill_no', 'valid_until'])
        .where('invoice_id', '=', id)
        .where('org_id', '=', orgId)
        .where('status', 'in', ['generated', 'expired'])
        .orderBy('id', 'desc')
        .executeTakeFirst(),
    ]);

    const retry =
      mark && (mark.status === 'pending' || mark.status === 'failed')
        ? (await queuedRetries(db, orgId, 'einvoice.register')).get(`invoice:${id}`) ?? null
        : null;

    // A delivery address is printed only when it differs from the billing one;
    // Rule 46 asks for it where goods go somewhere other than the recipient.
    const shipAddress = inv.ship_address?.trim() ?? '';
    const shipDiffers =
      shipAddress !== '' && shipAddress.toLowerCase() !== (inv.customer_address ?? '').trim().toLowerCase();
    const ewbNo = ewb?.eway_bill_no ?? inv.eway_bill_no;

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
      seller: {
        name: inv.org_legal_name || inv.org_name,
        tradeName: inv.org_legal_name && inv.org_legal_name !== inv.org_name ? inv.org_name : null,
        gstin: inv.branch_gstin,
        pan: inv.org_pan,
        address: inv.branch_address,
        city: inv.branch_city,
        pincode: inv.branch_pincode,
        stateCode: inv.branch_state,
        email: inv.org_email,
        phone: inv.org_phone,
        registration: inv.org_registration,
      },
      buyer: {
        name: inv.customer_legal_name || inv.customer_name,
        gstin: inv.customer_gstin,
        address: inv.customer_address,
        city: inv.customer_city,
        pincode: inv.customer_pincode,
        stateCode: inv.customer_state,
        treatment: inv.customer_treatment,
      },
      shipTo: shipDiffers ? { address: shipAddress, city: inv.ship_city, pincode: inv.ship_pincode } : null,
      ewayBill: ewbNo ? { number: ewbNo, validUntil: ewb?.valid_until ?? null } : null,
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
        description: l.description?.trim() || l.item_name || null,
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
        cessPaise: p(l.cess),
        totalPaise: p(l.line_total),
      })),
      einvoice: mark
        ? {
            status: mark.status,
            irn: mark.irn,
            ackNo: mark.ack_no,
            ackDate: mark.ack_date,
            // Printable only while the IRN stands. A cancelled one must never
            // reach paper looking as if it were still valid.
            signedQr: mark.status === 'submitted' ? mark.signed_qr_payload : null,
            environment: environmentOf(mark.provider ?? 'fake'),
            cancelledAt: mark.cancelled_at,
            cancelUntil: mark.status === 'submitted' ? irnCancelOpenUntil(mark.ack_date ?? mark.updated_at) : null,
            errorMessage: mark.status === 'failed' ? mark.error_message : null,
            cancelReason: mark.cancel_reason,
            retry,
          }
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
