import { z } from 'zod';
import { sql } from 'kysely';
import { db, transaction } from '@/lib/server/db';
import { route, body, query, asId, badRequest, notFound } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';
import { gstr1, gstr3b } from '@/lib/server/gst/returns';
import { einvoiceQueue, itcReconciliation, submitEinvoice, tdsSummary } from '@/lib/server/gst/compliance';
import { logAudit, auditMeta } from '@/lib/server/audit';

// ─────────────────────────────────────────────────────────────────────────────
// One endpoint for the GST screens.
//
// They all read the same invoices and bills through different lenses, and every
// one is recomputed on request. A return is a statement about a closed period;
// the only way it can be wrong is by disagreeing with the documents behind it,
// so nothing is cached in between.
// ─────────────────────────────────────────────────────────────────────────────

const MONTH = z.string().regex(/^\d{4}-\d{2}$/, 'Give the period as yyyy-mm.');
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Q = z.object({
  view: z.enum(['gstr1', 'gstr3b', 'einvoices', 'eway-bills', 'itc', 'tds']),
  period: MONTH.optional(),
  from: DATE.optional(),
  to: DATE.optional(),
  status: z.string().optional(),
  branchId: z.string().optional(),
});

const thisMonth = () => new Date().toISOString().slice(0, 7);

export const GET = route(
  async ({ orgId, req }) => {
    const q = query(req, Q);
    const period = q.period ?? thisMonth();
    const branchId = q.branchId ? Number(q.branchId) : undefined;

    switch (q.view) {
      case 'gstr1':
        return { view: q.view, ...(await gstr1(db, orgId, period, branchId)) };

      case 'gstr3b':
        return { view: q.view, ...(await gstr3b(db, orgId, period)) };

      case 'einvoices': {
        const { rows, counts } = await einvoiceQueue(db, orgId, q.status);
        return { view: q.view, einvoices: rows, statusCounts: counts };
      }

      case 'itc':
        return { view: q.view, period, ...(await itcReconciliation(db, orgId, period)) };

      case 'tds': {
        // The financial year to date by default: TDS thresholds are annual, so
        // a monthly view of them tells you nothing about whether one was crossed.
        const today = new Date().toISOString().slice(0, 10);
        const fyStart = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
        const from = q.from ?? `${fyStart}-04-01`;
        const to = q.to ?? today;
        return { view: q.view, from, to, ...(await tdsSummary(db, orgId, from, to)) };
      }

      case 'eway-bills': {
        // An e-way bill is needed for a consignment over ₹50,000 that moves.
        // The register lists what has one and what still needs one.
        const { rows } = await sql<{
          id: number | null; invoice_id: number; number: string; invoice_date: string;
          customer_name: string; place_of_supply: string; total: string; supply_kind: string;
          eway_bill_no: string | null; status: string | null; vehicle_no: string | null;
          transporter_name: string | null; distance_km: number | null; valid_until: string | null;
        }>`
          SELECT w.id, i.id AS invoice_id, i.number, i.invoice_date,
                 c.display_name AS customer_name, i.place_of_supply, i.total, i.supply_kind,
                 w.eway_bill_no, w.status, w.vehicle_no, w.transporter_name,
                 w.distance_km, w.valid_until
            FROM invoices i
            JOIN contacts c ON c.id = i.customer_id
            LEFT JOIN eway_bills w ON w.invoice_id = i.id
           WHERE i.org_id = ${orgId}
             AND i.status NOT IN ('draft', 'void')
             AND i.supply_kind <> 'service'
             AND i.total >= 50000
           ORDER BY i.invoice_date DESC
           LIMIT 300
        `.execute(db);

        return {
          view: q.view,
          ewayBills: rows.map((r) => ({
            id: r.id === null ? null : asId(r.id),
            invoiceId: asId(r.invoice_id),
            number: r.number,
            date: String(r.invoice_date).slice(0, 10),
            customerName: r.customer_name,
            placeOfSupply: r.place_of_supply,
            totalPaise: toPaiseFromSql(r.total),
            ewayBillNo: r.eway_bill_no,
            status: r.status ?? 'not_generated',
            vehicleNo: r.vehicle_no,
            transporterName: r.transporter_name,
            distanceKm: r.distance_km,
            validUntil: r.valid_until ? String(r.valid_until).slice(0, 10) : null,
          })),
        };
      }
    }
  },
  { permission: { module: 'gst', action: 'view' } },
);

const ActionInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit-einvoice'),
    invoiceId: z.union([z.string(), z.number()]),
  }),
  z.object({
    action: z.literal('generate-eway-bill'),
    invoiceId: z.union([z.string(), z.number()]),
    vehicleNo: z.string().trim().max(20).nullish(),
    transporterName: z.string().trim().max(150).nullish(),
    distanceKm: z.number().int().positive().nullish(),
    transportMode: z.enum(['road', 'rail', 'air', 'ship']).optional(),
  }),
]);

export const POST = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, ActionInput);
    const invoiceId = Number(input.invoiceId);

    if (input.action === 'submit-einvoice') {
      const result = await transaction((trx) => submitEinvoice(trx, orgId, invoiceId));
      await logAudit({
        orgId, actorUserId: user.userId, actorName: user.name, action: 'approve',
        targetType: 'einvoice', targetId: invoiceId,
        detail: `IRN registered: ${result.irn.slice(0, 16)}…`, ...auditMeta(req),
      });
      return result;
    }

    const invoice = await db
      .selectFrom('invoices')
      .select(['id', 'number', 'status', 'total', 'supply_kind'])
      .where('id', '=', invoiceId).where('org_id', '=', orgId).executeTakeFirst();
    if (!invoice) throw notFound('That invoice does not exist.');
    if (invoice.status === 'draft' || invoice.status === 'void') {
      throw badRequest('Only an issued invoice can carry an e-way bill.');
    }
    // The threshold is on the consignment, and services do not move.
    if (toPaiseFromSql(invoice.total) < 50_000_00) {
      throw badRequest('An e-way bill is only required above ₹50,000.');
    }
    if (invoice.supply_kind === 'service') {
      throw badRequest('Services do not move, so they need no e-way bill.');
    }

    const existing = await db
      .selectFrom('eway_bills').select(['id', 'status', 'eway_bill_no'])
      .where('invoice_id', '=', invoiceId).where('org_id', '=', orgId).executeTakeFirst();
    if (existing?.status === 'generated') {
      return { ewayBillNo: existing.eway_bill_no, status: 'generated' };
    }

    // Stand-in for the NIC portal, clearly marked. Validity is one day per 200km
    // for regular cargo, minimum one day — the rule the portal applies.
    const km = input.distanceKm ?? 100;
    const validDays = Math.max(1, Math.ceil(km / 200));
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validDays);
    const ewayBillNo = `9${String(invoiceId).padStart(11, '0')}`;

    const values = {
      org_id: orgId,
      invoice_id: invoiceId,
      eway_bill_no: ewayBillNo,
      status: 'generated' as const,
      transport_mode: input.transportMode ?? ('road' as const),
      vehicle_no: input.vehicleNo ?? null,
      transporter_name: input.transporterName ?? null,
      distance_km: km,
      generated_at: new Date(),
      valid_until: validUntil,
    };

    if (existing) {
      await db.updateTable('eway_bills').set(values).where('id', '=', existing.id).execute();
    } else {
      await db.insertInto('eway_bills').values(values).execute();
    }

    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'approve',
      targetType: 'eway_bill', targetId: invoiceId, targetLabel: invoice.number,
      detail: `E-way bill ${ewayBillNo} generated, valid ${validDays} day(s)`, ...auditMeta(req),
    });

    return {
      ewayBillNo,
      status: 'generated',
      validUntil: validUntil.toISOString().slice(0, 10),
      validDays,
    };
  },
  { permission: { module: 'gst', action: 'approve' } },
);
