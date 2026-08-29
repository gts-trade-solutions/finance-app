// Seed the database.
//   npm run db:seed              create the demo organisation and master data
//   npm run db:seed -- --fresh   wipe the data first, keeping the schema
//
// Runs inside one transaction: either the whole book appears or none of it
// does. A half-seeded database is worse than an empty one, because it looks
// usable right up until the first missing account.

import { db, transaction } from '../lib/server/db';
import { bootstrap } from '../lib/server/seed/bootstrap';
import { verifyLedgerBalances } from '../lib/server/ledger/posting';

const fresh = process.argv.includes('--fresh');

/** Tables cleared by --fresh, in an order that respects foreign keys. */
const DATA_TABLES = [
  'payment_allocations', 'payments', 'bank_transactions', 'bank_statement_imports',
  'bank_transfers', 'bank_rules', 'cheques', 'bank_accounts',
  'einvoices', 'eway_bills', 'gstr2b_entries',
  'invoice_lines', 'credit_note_lines', 'estimate_lines', 'sales_order_lines',
  'challan_lines', 'bill_lines', 'purchase_order_lines',
  'credit_notes', 'invoices', 'delivery_challans', 'sales_orders', 'estimates',
  'retainer_invoices', 'vendor_credits', 'bills', 'expenses', 'purchase_orders',
  'recurring_invoices', 'recurring_journals',
  'journal_lines', 'journal_entries', 'number_series', 'transaction_locks',
  'custom_field_values', 'custom_fields', 'approval_rules', 'workflow_rules',
  'api_tokens', 'jobs', 'files', 'settings', 'audit_log',
  'items', 'hsn_codes', 'contacts', 'accounts',
  'user_branches', 'sessions', 'users', 'branches', 'organizations',
];

async function main() {
  if (fresh) {
    if (process.env.APP_ENV === 'production') {
      console.error('Refusing to wipe data in production.');
      process.exit(1);
    }
    console.log('Clearing existing data…');
    const { sql } = await import('kysely');
    await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
    for (const t of DATA_TABLES) {
      await sql.raw(`DELETE FROM \`${t}\``).execute(db);
      await sql.raw(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`).execute(db).catch(() => {
        // Tables without an AUTO_INCREMENT column, such as settings.
      });
    }
    await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
    console.log(`  cleared ${DATA_TABLES.length} tables`);
  }

  const existing = await db.selectFrom('organizations').select('id').executeTakeFirst();
  if (existing && !fresh) {
    console.log('\n  An organisation already exists. Use --fresh to start over.\n');
    await db.destroy();
    return;
  }

  const started = Date.now();
  const ids = await transaction(async (trx) => bootstrap(trx));

  const check = await transaction(async (trx) => verifyLedgerBalances(trx, ids.orgId));

  console.log(`
  Seeded in ${Date.now() - started}ms

    organisation   ${ids.orgId}
    branches       ${Object.keys(ids.branches).length}
    users          ${Object.keys(ids.users).length}
    accounts       ${Object.keys(ids.accounts).length}
    contacts       ${Object.keys(ids.contacts).length}
    items          ${Object.keys(ids.items).length}
    bank accounts  ${Object.keys(ids.bankAccounts).length}

    ledger         ${check.balanced ? 'balanced' : 'OUT OF BALANCE'}

  Sign in with any seeded user, password Finora@2026:
    arun@raceautospares.in     admin
    priya@raceautospares.in    accountant
    vikram@raceautospares.in   sales
    deepa@raceautospares.in    viewer
`);

  await db.destroy();
}

main().catch(async (err) => {
  console.error('\n  Seed failed — nothing was committed.\n', err);
  await db.destroy();
  process.exit(1);
});
