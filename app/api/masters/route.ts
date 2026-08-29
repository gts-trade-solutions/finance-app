import { db } from '@/lib/server/db';
import { route, asId } from '@/lib/server/http';
import { toPaiseFromSql } from '@/lib/server/money-sql';
import { peekNumber } from '@/lib/server/ledger/posting';
import { fyLabelFor } from '@/lib/server/services/sales';

/**
 * Everything a document form needs to render, in one request.
 *
 * The invoice form needs customers, items, HSN codes, branches, salespeople and
 * the next invoice number. Six round trips before the user can type anything is
 * a form that feels slow on a phone; these are all small, rarely-changing lists,
 * so they travel together.
 */
export const GET = route(
  async ({ orgId, user, req }) => {
    const url = new URL(req.url);
    const forDate = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    const branchId = Number(url.searchParams.get('branchId') || user.activeBranchId || 0);

    const [contacts, items, hsnCodes, branches, users, accounts, bankAccounts] = await Promise.all([
      db
        .selectFrom('contacts')
        .select([
          'id', 'kind', 'display_name', 'gstin', 'gst_treatment', 'state_code',
          'email', 'phone', 'payment_terms', 'is_msme', 'tds_section', 'billing_address',
        ])
        .where('org_id', '=', orgId)
        .where('is_archived', '=', 0)
        .orderBy('display_name')
        .execute(),
      db
        .selectFrom('items')
        .select([
          'id', 'kind', 'name', 'sku', 'hsn_sac', 'uqc', 'sale_price',
          'purchase_price', 'gst_rate_pct', 'tax_pref',
        ])
        .where('org_id', '=', orgId)
        .where('is_archived', '=', 0)
        .orderBy('name')
        .execute(),
      db
        .selectFrom('hsn_codes')
        .select(['id', 'code', 'kind', 'description', 'gst_rate_pct', 'uqc', 'is_active'])
        .where('org_id', '=', orgId)
        .orderBy('code')
        .execute(),
      db
        .selectFrom('branches')
        .select(['id', 'name', 'gstin', 'state_code', 'address', 'is_primary'])
        .where('org_id', '=', orgId)
        .where('is_active', '=', 1)
        .orderBy('is_primary', 'desc')
        .execute(),
      db
        .selectFrom('users')
        .select(['id', 'name', 'email', 'role', 'home_branch_id'])
        .where('org_id', '=', orgId)
        .where('is_active', '=', 1)
        .orderBy('name')
        .execute(),
      db
        .selectFrom('accounts')
        .select(['id', 'code', 'name', 'type', 'subtype', 'is_system'])
        .where('org_id', '=', orgId)
        .where('is_active', '=', 1)
        .orderBy('code')
        .execute(),
      db
        .selectFrom('bank_accounts')
        .select(['id', 'kind', 'name', 'bank_name', 'account_last4', 'ledger_account_id'])
        .where('org_id', '=', orgId)
        .where('is_active', '=', 1)
        .orderBy('is_primary', 'desc')
        .execute(),
    ]);

    // Peeked, not allocated — showing a number in a form must not consume one,
    // or every abandoned draft leaves a gap in the series.
    const nextInvoiceNumber = branchId
      ? await db.transaction().execute((trx) =>
          peekNumber(trx, orgId, branchId, 'INV', fyLabelFor(forDate), 'INV'),
        )
      : null;

    return {
      contacts: contacts.map((c) => ({
        id: asId(c.id),
        kind: c.kind,
        displayName: c.display_name,
        gstin: c.gstin,
        gstTreatment: c.gst_treatment,
        stateCode: c.state_code,
        email: c.email,
        phone: c.phone,
        paymentTerms: c.payment_terms,
        isMsme: !!c.is_msme,
        tdsSection: c.tds_section,
        billingAddress: c.billing_address,
      })),
      items: items.map((i) => ({
        id: asId(i.id),
        kind: i.kind,
        name: i.name,
        sku: i.sku,
        hsnSac: i.hsn_sac,
        uqc: i.uqc,
        salePricePaise: toPaiseFromSql(i.sale_price),
        purchasePricePaise: toPaiseFromSql(i.purchase_price),
        gstRatePct: Number(i.gst_rate_pct),
        taxPref: i.tax_pref,
      })),
      hsnCodes: hsnCodes.map((h) => ({
        id: asId(h.id),
        code: h.code,
        kind: h.kind,
        description: h.description,
        gstRatePct: Number(h.gst_rate_pct),
        uqc: h.uqc,
        isActive: !!h.is_active,
      })),
      branches: branches.map((b) => ({
        id: asId(b.id),
        name: b.name,
        gstin: b.gstin,
        stateCode: b.state_code,
        address: b.address,
        isPrimary: !!b.is_primary,
      })),
      users: users.map((u) => ({
        id: asId(u.id),
        name: u.name,
        email: u.email,
        role: u.role,
        branchId: u.home_branch_id ? asId(u.home_branch_id) : null,
      })),
      accounts: accounts.map((a) => ({
        id: asId(a.id),
        code: a.code,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        isSystem: !!a.is_system,
      })),
      bankAccounts: bankAccounts.map((b) => ({
        id: asId(b.id),
        kind: b.kind,
        name: b.name,
        bankName: b.bank_name,
        accountLast4: b.account_last4,
        ledgerAccountId: asId(b.ledger_account_id),
      })),
      nextInvoiceNumber,
    };
  },
  { permission: { module: 'sales', action: 'view' } },
);
