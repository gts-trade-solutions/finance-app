import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '@/lib/server/db';
import { route, body, asId, badRequest } from '@/lib/server/http';
import { isValidGstin } from '@/lib/tax/gst';
import { logAudit, auditMeta } from '@/lib/server/audit';

// ─────────────────────────────────────────────────────────────────────────────
// Organisation settings: the profile, its branches, its users, and the number
// series each branch is using.
//
// The number series is read, never written. A series is advanced by the
// sequences table as documents are raised, and letting somebody set the next
// number by hand is how a book ends up with two invoices sharing a number —
// which is a question at assessment, not a display problem.
// ─────────────────────────────────────────────────────────────────────────────

export const GET = route(
  async ({ orgId }) => {
    const [org, branches, users, series, counts] = await Promise.all([
      db
        .selectFrom('organizations')
        .selectAll()
        .where('id', '=', orgId)
        .executeTakeFirst(),
      db
        .selectFrom('branches')
        .select([
          'id', 'name', 'gstin', 'state_code', 'address', 'city', 'pincode',
          'is_primary', 'is_active',
        ])
        .where('org_id', '=', orgId)
        .orderBy('is_primary', 'desc')
        .execute(),
      db
        .selectFrom('users')
        .select(['id', 'name', 'email', 'role', 'home_branch_id', 'is_active', 'last_login_at'])
        .where('org_id', '=', orgId)
        .orderBy('name')
        .execute(),
      db
        .selectFrom('sequences')
        .select(['name', 'next_value'])
        .where('org_id', '=', orgId)
        .orderBy('name')
        .execute(),
      // What the org actually holds, so the page can say how much is at stake
      // before somebody changes something.
      sql<{ contacts: string; items: string; invoices: string; entries: string }>`
        SELECT
          (SELECT COUNT(*) FROM contacts WHERE org_id = ${orgId} AND is_archived = 0) AS contacts,
          (SELECT COUNT(*) FROM items WHERE org_id = ${orgId} AND is_archived = 0) AS items,
          (SELECT COUNT(*) FROM invoices WHERE org_id = ${orgId}) AS invoices,
          (SELECT COUNT(*) FROM journal_entries WHERE org_id = ${orgId}) AS entries
      `.execute(db),
    ]);

    if (!org) throw badRequest('No organisation is set up.');

    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const c = counts.rows[0];

    return {
      org: {
        id: asId(org.id),
        name: org.name,
        legalName: org.legal_name,
        pan: org.pan,
        email: org.email,
        phone: org.phone,
        address: org.address,
        fiscalYearStartMonth: org.fiscal_year_start_month,
        currency: org.base_currency,
        gstRegistrationType: org.gst_registration_type,
        // Aggregate turnover above ₹5 crore makes e-invoicing mandatory.
        einvoiceApplicable: !!org.aato_above_5cr,
      },
      branches: branches.map((b) => ({
        id: asId(b.id),
        name: b.name,
        gstin: b.gstin,
        stateCode: b.state_code,
        address: b.address,
        // Both are mandatory on every e-invoice and e-way bill, as their own
        // fields. Until they are filled in, nothing can be registered.
        city: b.city,
        pincode: b.pincode,
        isPrimary: !!b.is_primary,
        isActive: !!b.is_active,
      })),
      users: users.map((u) => ({
        id: asId(u.id),
        name: u.name,
        email: u.email,
        role: u.role,
        branchName: u.home_branch_id ? (branchName.get(u.home_branch_id) ?? null) : null,
        isActive: !!u.is_active,
        lastLoginAt: u.last_login_at
          ? (u.last_login_at instanceof Date ? u.last_login_at : new Date(String(u.last_login_at))).toISOString()
          : null,
      })),
      // 'INV:26-27' or 'INV:26-27:3' — the document type, the year, and the
      // branch when the series is per branch.
      series: series.map((s) => {
        const [docType, fy, branchId] = s.name.split(':');
        return {
          scope: s.name,
          docType,
          fyLabel: fy ?? '',
          branchName: branchId ? (branchName.get(Number(branchId)) ?? null) : null,
          nextValue: Number(s.next_value),
        };
      }),
      counts: {
        contacts: Number(c.contacts),
        items: Number(c.items),
        invoices: Number(c.invoices),
        journalEntries: Number(c.entries),
      },
    };
  },
  { permission: { module: 'settings', action: 'view' } },
);

const OrgInput = z.object({
  name: z.string().trim().min(1, 'The organisation needs a name.').max(200),
  legalName: z.string().trim().max(200).nullish(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'A PAN is five letters, four digits, a letter.').nullish()
    .or(z.literal('').transform(() => null)),
  email: z.string().trim().email('That email does not look right.').nullish()
    .or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(30).nullish(),
  address: z.string().trim().max(500).nullish(),
});

/**
 * Update the organisation profile.
 *
 * Deliberately narrow. The fiscal year start, the base currency and the GST
 * registration status are not editable here: every posted entry, every return
 * and every number series was produced under them, and changing one after the
 * fact would make the history mean something different from what it said when
 * it was written.
 */
export const PATCH = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, OrgInput);

    await db
      .updateTable('organizations')
      .set({
        name: input.name,
        legal_name: input.legalName ?? null,
        pan: input.pan ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
      })
      .where('id', '=', orgId)
      .execute();

    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'update',
      targetType: 'organization', targetId: orgId, targetLabel: input.name,
      detail: `Updated the organisation profile`, ...auditMeta(req),
    });

    return { id: asId(orgId), name: input.name };
  },
  { permission: { module: 'settings', action: 'edit' } },
);

// ─────────────────────────────────────────────────────────────────────────────
// A branch's own details.
//
// Separate from the organisation profile because a branch *is* a GST
// registration, and the two things that were never collected here — the city
// and the PIN code — are mandatory on every e-invoice and every e-way bill,
// as their own fields. Nothing can be registered with the portals until they
// are filled in, and the pre-flight check has no way to fix that for the user.
// ─────────────────────────────────────────────────────────────────────────────

const BranchInput = z.object({
  branchId: z.union([z.string(), z.number()]),
  name: z.string().trim().min(1, 'The registration needs a name.').max(150),
  // Editable on purpose. A sign-up types its GSTIN once, and until now a typo
  // could not be corrected anywhere in the app — which matters more than
  // usual, because a wrong GSTIN fails at the portal rather than on screen.
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
      'A GSTIN is 15 characters: two state digits, a PAN, an entity digit, Z, and a check digit.',
    )
    .nullish()
    .or(z.literal('').transform(() => null)),
  address: z.string().trim().max(500).nullish().or(z.literal('').transform(() => null)),
  city: z.string().trim().max(60).nullish().or(z.literal('').transform(() => null)),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9]\d{5}$/, 'A PIN code is six digits and cannot start with 0.')
    .nullish()
    .or(z.literal('').transform(() => null)),
});

export const PUT = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, BranchInput);
    const branchId = Number(input.branchId);

    const existing = await db
      .selectFrom('branches')
      .select(['id', 'name', 'gstin', 'state_code'])
      .where('id', '=', branchId)
      .where('org_id', '=', orgId)
      .executeTakeFirst();
    if (!existing) throw badRequest('That registration does not belong to this organisation.');

    // The first two digits of a GSTIN *are* the state, and the state is not
    // editable here — every number series and every posted document was
    // written under it. So a GSTIN from a different state is a typo, and the
    // portal would reject it anyway.
    if (input.gstin && input.gstin.slice(0, 2) !== existing.state_code) {
      throw badRequest(
        `That GSTIN begins ${input.gstin.slice(0, 2)}, but this registration is in state ` +
          `${existing.state_code}. A registration cannot be moved between states — add a new one instead.`,
      );
    }
    if (input.gstin && !isValidGstin(input.gstin)) {
      throw badRequest(`${input.gstin} fails its checksum, so it is mistyped somewhere.`);
    }

    await db
      .updateTable('branches')
      .set({
        name: input.name,
        gstin: input.gstin ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        pincode: input.pincode ?? null,
      })
      .where('id', '=', branchId)
      .where('org_id', '=', orgId)
      .execute();

    // Worth its own audit line rather than folding into the org update: a
    // changed GSTIN invalidates the portal credentials stored against it, and
    // "when did this GSTIN change" is the first question when that surfaces.
    const gstinChanged = (existing.gstin ?? null) !== (input.gstin ?? null);
    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name, action: 'update',
      targetType: 'branch', targetId: branchId, targetLabel: input.name,
      detail: gstinChanged
        ? `GSTIN changed from ${existing.gstin ?? 'none'} to ${input.gstin ?? 'none'}`
        : 'Updated the registration details',
      ...auditMeta(req),
    });

    return {
      id: asId(branchId),
      gstinChanged,
      // Said back to the caller so the UI can warn rather than let somebody
      // discover it on their next submission.
      note: gstinChanged
        ? 'Any portal credentials stored for this registration were issued for the old GSTIN and will ' +
          'have to be entered again.'
        : null,
    };
  },
  { permission: { module: 'settings', action: 'edit' } },
);
