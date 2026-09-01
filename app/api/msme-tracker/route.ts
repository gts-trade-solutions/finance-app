import { sql } from 'kysely';
import { db } from '@/lib/server/db';
import { route, asId } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';

// ─────────────────────────────────────────────────────────────────────────────
// The MSME 45-day tracker.
//
// Section 43B(h) of the Income Tax Act: if you buy from a registered micro or
// small enterprise and do not pay within 45 days, you cannot claim that expense
// in the year it was incurred. The deduction only returns in the year you
// actually pay — so a late payment quietly increases the tax you owe on money
// you have already spent.
//
// The clock runs from the bill date, and only bills still unpaid matter. A
// settled bill is out of scope however long it took, because the payment
// happened inside the year either way.
// ─────────────────────────────────────────────────────────────────────────────

export const GET = route(
  async ({ orgId }) => {
    const asOf = new Date().toISOString().slice(0, 10);

    const { rows } = await sql<{
      id: number; internal_no: string; vendor_invoice_no: string; vendor_id: number;
      name: string; udyam: string | null; bill_date: string; due_date: string;
      age: number; balance: string; total: string;
    }>`
      SELECT b.id, b.internal_no, b.vendor_invoice_no, b.vendor_id,
             c.display_name AS name, c.msme_udyam_no AS udyam,
             b.bill_date, b.due_date,
             DATEDIFF(${asOf}, b.bill_date) AS age,
             (b.total - b.amount_paid) AS balance,
             b.total
        FROM bills b
        JOIN contacts c ON c.id = b.vendor_id
       WHERE b.org_id = ${orgId}
         AND c.is_msme = 1
         AND b.status NOT IN ('draft', 'void')
         AND b.total > b.amount_paid
       ORDER BY age DESC, b.id DESC
    `.execute(db);

    const items = rows.map((r) => {
      const age = Number(r.age);
      return {
        billId: asId(r.id),
        internalNo: r.internal_no,
        vendorInvoiceNo: r.vendor_invoice_no,
        vendorId: asId(r.vendor_id),
        vendorName: r.name,
        udyamNo: r.udyam,
        date: String(r.bill_date).slice(0, 10),
        dueDate: String(r.due_date).slice(0, 10),
        age,
        daysLeft: 45 - age,
        balancePaise: toPaiseFromSql(r.balance),
        totalPaise: toPaiseFromSql(r.total),
        // Breached means the deduction is already gone for this year. Critical
        // is the last week before that happens.
        risk: (age >= 45 ? 'breached' : age >= 38 ? 'critical' : 'safe') as
          'breached' | 'critical' | 'safe',
      };
    });

    const breached = items.filter((i) => i.risk === 'breached');
    const critical = items.filter((i) => i.risk === 'critical');

    return {
      asOf,
      items,
      summary: {
        breached: breached.length,
        critical: critical.length,
        safe: items.length - breached.length - critical.length,
        // What the disallowance would actually apply to if nothing is paid.
        atRiskPaise: [...breached, ...critical].reduce((t, i) => t + i.balancePaise, 0),
        totalOwedPaise: items.reduce((t, i) => t + i.balancePaise, 0),
      },
    };
  },
  { permission: { module: 'purchases', action: 'view' } },
);
