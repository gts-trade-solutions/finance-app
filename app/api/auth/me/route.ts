import { db } from '@/lib/server/db';
import { route, asId } from '@/lib/server/http';

/**
 * Who am I, and what may I act on?
 *
 * The client bootstraps from this on load. It returns the branches the user can
 * raise documents for, so the branch switcher never offers one the server would
 * refuse.
 */
export const GET = route(async ({ user }) => {
  const [org, branches] = await Promise.all([
    db.selectFrom('organizations').selectAll().where('id', '=', user.orgId).executeTakeFirst(),
    db
      .selectFrom('branches')
      .select(['id', 'name', 'gstin', 'state_code', 'address', 'is_primary'])
      .where('org_id', '=', user.orgId)
      .where('is_active', '=', 1)
      .orderBy('is_primary', 'desc')
      .orderBy('name')
      .execute(),
  ]);

  const allowed = await db
    .selectFrom('user_branches')
    .select('branch_id')
    .where('user_id', '=', user.userId)
    .execute();
  const allowedIds = new Set(allowed.map((r) => r.branch_id));

  return {
    user: {
      id: asId(user.userId),
      name: user.name,
      email: user.email,
      role: user.role,
      branchId: user.homeBranchId ? asId(user.homeBranchId) : null,
      activeBranchId: user.activeBranchId ? asId(user.activeBranchId) : null,
    },
    org: org && {
      id: asId(org.id),
      name: org.name,
      pan: org.pan,
      gstRegistrationType: org.gst_registration_type,
      aatoAbove5Cr: !!org.aato_above_5cr,
      fiscalYearStartMonth: org.fiscal_year_start_month,
      baseCurrency: org.base_currency,
      address: org.address,
      email: org.email,
      phone: org.phone,
      onboarded: !!org.onboarded_at,
    },
    // No explicit grants means the user works in their home branch only.
    branches: branches
      .filter((b) => allowedIds.size === 0 ? b.id === user.homeBranchId : allowedIds.has(b.id))
      .map((b) => ({
        id: asId(b.id),
        name: b.name,
        gstin: b.gstin,
        stateCode: b.state_code,
        address: b.address,
        isPrimary: !!b.is_primary,
      })),
  };
});
