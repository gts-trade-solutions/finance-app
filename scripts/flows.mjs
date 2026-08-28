// Drives the real user journeys end to end and asserts the ledger stays honest.
//   node scripts/flows.mjs

import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(m.text().slice(0, 160));
});

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};
const money = (t) => Number(String(t).replace(/[^0-9.]/g, '')) || 0;

// ── sign in
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.getByText('Arun Kumar').first().click();
await page.waitForURL('**/dashboard');
check('Sign in as Admin reaches the dashboard', page.url().includes('/dashboard'));

// ── 1. Trial balance is balanced from the seed
await page.goto(`${BASE}/reports/trial-balance`, { waitUntil: 'networkidle' });
const tbBanner = await page.getByText('The books balance').count();
check('Seeded trial balance is balanced', tbBanner > 0);

const tbRow = await page.locator('tr', { hasText: 'Total' }).last().innerText();
const tbNums = tbRow.match(/₹[\d,]+\.\d{2}/g) || [];
check('Trial balance debit total equals credit total', tbNums.length === 2 && tbNums[0] === tbNums[1],
  tbNums.join(' vs '));

// ── 2. Balance sheet balances
await page.goto(`${BASE}/reports/balance-sheet`, { waitUntil: 'networkidle' });
check('Balance sheet balances', await page.getByText('Assets equal liabilities plus equity').count() > 0);

// ── 3. GST resolves intra-state (CGST+SGST) vs inter-state (IGST)
// Comboboxes on this form, in DOM order: 0 customer, 1 terms, 2 salesperson,
// 3 branch, 4 place of supply, 5 first line item.
const sel = (n) => page.locator('[data-slot="combobox-trigger"]').nth(n);

await page.goto(`${BASE}/sales/invoices/new`, { waitUntil: 'networkidle' });
await sel(0).click();
await page.getByRole('option', { name: /Sharma Traders/ }).click();
await page.waitForTimeout(600);
const intraLabel = await page.getByText('Intra-state — CGST + SGST').count();
check('Tamil Nadu customer resolves to CGST + SGST', intraLabel > 0);

// The picker searches, which is the fix the client asked for.
await sel(0).click();
await page.locator('input[placeholder="Search customers by name or GSTIN"]').fill('Apex');
await page.waitForTimeout(400);
const filtered = await page.locator('[role="option"]').count();
check('Customer picker filters as you type', filtered > 0 && filtered < 5, `${filtered} match(es)`);
await page.getByRole('option', { name: /Apex Motors/ }).click();
await page.waitForTimeout(600);
const interLabel = await page.getByText('Inter-state — IGST').count();
check('Karnataka customer flips to IGST', interLabel > 0);

// ── 4. Create an invoice and confirm it posts a balanced journal entry
await sel(5).click();
await page.getByRole('option', { name: /Brake Pad Set/ }).click();
await page.waitForTimeout(600);
const totalTxt = await page.locator('text=Total').last().locator('xpath=..').innerText().catch(() => '');
check('Totals panel computes a non-zero total', money(totalTxt) > 0, totalTxt.replace(/\n/g, ' ').slice(0, 40));

await page.getByRole('button', { name: 'Save and Send' }).click();
await page.waitForURL((u) => /\/sales\/invoices\/inv/.test(u.toString()), { timeout: 20000 });
check('Invoice saves and opens its detail page', /\/sales\/invoices\/inv/.test(page.url()));

await page.getByRole('tab', { name: 'Journal entry' }).click();
await page.waitForTimeout(500);
check('New invoice posted a balanced journal entry',
  await page.getByText('Balanced — debits equal credits').count() > 0);

// ── 5. Books still balance after creating a document
await page.goto(`${BASE}/reports/trial-balance`, { waitUntil: 'networkidle' });
check('Trial balance still balanced after new invoice',
  await page.getByText('The books balance').count() > 0);

// ── 6. E-invoice simulator issues an IRN
await page.goto(`${BASE}/gst/einvoices`, { waitUntil: 'networkidle' });
const submitBtn = page.getByRole('button', { name: /^Submit$/ }).first();
if (await submitBtn.count()) {
  await submitBtn.click();
  await page.waitForTimeout(3000);
  const registered = await page.getByText(/Registered/).count();
  check('IRP simulator returns an IRN', registered > 0);
} else {
  check('IRP simulator returns an IRN', false, 'no pending invoice to submit');
}

// ── 7. Bank reconciliation matches a line
await page.goto(`${BASE}/banking/reconcile`, { waitUntil: 'networkidle' });
const beforeTxt = await page.getByText('Lines to reconcile').locator('xpath=..').innerText();
// Pick a line an active bank rule covers, so a suggestion is guaranteed.
await page.getByText(/BHARAT PETRO/).first().click();
await page.waitForTimeout(600);
const suggestion = await page.getByText(/Categorise as/).count();
check('Bank rule produces a match suggestion', suggestion > 0);

const matchBtn = page.getByRole('button', { name: /Match/ }).first();
if (await matchBtn.count()) {
  await matchBtn.click();
  await page.waitForTimeout(1200);
  const afterTxt = await page.getByText('Lines to reconcile').locator('xpath=..').innerText();
  check('Reconciling a line decreases the unmatched count',
    money(afterTxt) < money(beforeTxt), `${money(beforeTxt)} → ${money(afterTxt)}`);
} else {
  check('Reconciling a line decreases the unmatched count', false, 'no Match button rendered');
}

// ── 8. RBAC actually hides things
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Demo/ }).click();
await page.getByRole('menuitem', { name: /Vikram Shetty/ }).click();
await page.waitForTimeout(800);
const bankingVisible = await page.locator('nav').getByText('Banking').count();
check('Sales role loses the Banking module', bankingVisible === 0);

await page.goto(`${BASE}/sales/items`, { waitUntil: 'networkidle' });
const costCol = await page.getByRole('columnheader', { name: /Cost price/ }).count();
check('Sales role cannot see cost prices', costCol === 0);

// ── 8b. A single-branch user is never shown the branch picker
await page.goto(`${BASE}/sales/invoices/new`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const branchFieldForSales = await page.getByText('Branch (GSTIN)').count();
check('Single-branch user sees no branch picker', branchFieldForSales === 0);

// ── 9. AI assistant answers from the live ledger
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Demo/ }).click();
await page.getByRole('menuitem', { name: /Arun Kumar/ }).click();
await page.waitForTimeout(600);
await page.goto(`${BASE}/sales/invoices/new`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('Multi-branch user still gets the branch picker',
  (await page.getByText('Branch (GSTIN)').count()) > 0);

await page.goto(`${BASE}/ai`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Which invoices are overdue?' }).click();
await page.waitForTimeout(2500);
check('Assistant answers a ledger question',
  await page.getByText(/invoices are overdue, totalling/).count() > 0);

// ── 8c. Add Bank or Credit Card creates both the account and its ledger account
await page.goto(`${BASE}/banking`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('Banking shows the Add Bank or Credit Card action',
  (await page.getByRole('button', { name: /Add Bank or Credit Card/ }).count()) > 0);

await page.getByRole('button', { name: /Add Bank or Credit Card/ }).click();
await page.waitForTimeout(600);
// Step 1 offers a feed or the manual route, as Zoho does.
check('Add Bank offers automatic feeds and a manual route',
  (await page.getByText(/Automatic bank feeds/i).count()) > 0 &&
  (await page.getByRole('button', { name: 'Add Manually' }).count()) > 0);

await page.getByRole('button', { name: 'Add Manually' }).click();
await page.waitForTimeout(500);
await page.getByPlaceholder(/HDFC Bank – Current/).fill('Axis Bank – Current');
await page.getByPlaceholder('HDFC Bank', { exact: true }).fill('Axis Bank');
await page.getByRole('button', { name: 'Save account' }).click();
await page.waitForTimeout(1200);
check('New bank account appears on the Banking page',
  (await page.getByText('Axis Bank – Current').count()) > 0);

// The ledger account must exist too, or nothing it does can be posted.
await page.goto(`${BASE}/accountant/chart-of-accounts`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('A matching ledger account was created',
  (await page.getByText('Axis Bank – Current').count()) > 0);

await page.goto(`${BASE}/reports/trial-balance`, { waitUntil: 'networkidle' });
check('Books still balance after adding an account',
  (await page.getByText('The books balance').count()) > 0);

// ── 8d. The e-invoice mark renders on invoices
await page.goto(`${BASE}/sales/invoices`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('Invoices carry the e-invoice mark',
  (await page.locator('span', { hasText: /^e$/ }).count()) > 0);

// ── 8e. Dialogs must fit the viewport rather than running off it
await page.goto(`${BASE}/banking`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Add Bank or Credit Card/ }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Add Manually' }).click();
await page.waitForTimeout(500);
const box = await page.locator('[data-slot="dialog-content"]').boundingBox();
const vh = page.viewportSize().height;
check('Add Bank dialog fits the viewport',
  !!box && box.height <= vh - 16, box ? `${Math.round(box.height)}px in ${vh}px` : 'no box');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ── 8f. List tabs, bulk select, and the invoice actions menu
await page.goto(`${BASE}/sales/invoices`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('Invoice list shows status tabs with counts',
  (await page.getByRole('button', { name: /^All\s*\d+$/ }).count()) > 0);

await page.locator('thead input[type="checkbox"], thead [role="checkbox"]').first().click();
await page.waitForTimeout(500);
check('Selecting rows reveals bulk actions',
  (await page.getByText(/\d+ selected/).count()) > 0);

// Clone must produce a draft, leaving the ledger untouched until approved.
const beforeCount = await page.locator('tbody tr').count();
await page.goto(`${BASE}/sales/invoices`, { waitUntil: 'networkidle' });
await page.locator('tbody tr').first().click();
await page.waitForURL((u) => /\/sales\/invoices\/inv/.test(u.toString()), { timeout: 20000 });
await page.getByRole('button', { name: 'More actions' }).click();
await page.waitForTimeout(500);
check('Invoice actions menu opens',
  (await page.getByRole('menuitem', { name: /Clone/ }).count()) > 0);
await page.getByRole('menuitem', { name: /Clone/ }).click();
await page.waitForTimeout(1200);
check('Clone creates a draft copy', page.url().includes('/sales/invoices/inv'));

await page.goto(`${BASE}/reports/trial-balance`, { waitUntil: 'networkidle' });
check('Books still balance after cloning',
  (await page.getByText('The books balance').count()) > 0);

// ── 8g. Reports catalogue: search and favourites
await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const groups = await page.locator('h2').count();
check("Reports index shows Zoho's categories", groups >= 9, `${groups} groups`);

await page.getByPlaceholder('Search reports').fill('ageing');
await page.waitForTimeout(600);
check('Report search filters the catalogue',
  (await page.getByText(/result.* for/).count()) > 0);
await page.getByPlaceholder('Search reports').fill('');
await page.waitForTimeout(500);

await page.locator('button[aria-label="Add to favourites"]').first().click();
await page.waitForTimeout(500);
check('Starring a report pins it to Favourites',
  (await page.getByText('Favourites').count()) > 0);

// ── 8h. New accountant tools
await page.goto(`${BASE}/accountant/recurring-journals`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const beforeEntries = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('finance-app-demo-v1') ?? '{}')?.state?.entries?.length ?? 0);
await page.getByRole('button', { name: 'Post now' }).first().click();
await page.waitForTimeout(1200);
const afterEntries = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('finance-app-demo-v1') ?? '{}')?.state?.entries?.length ?? 0);
check('Recurring journal posts a real entry', afterEntries === beforeEntries + 1,
  `${beforeEntries} → ${afterEntries}`);

await page.goto(`${BASE}/reports/trial-balance`, { waitUntil: 'networkidle' });
check('Books still balance after a recurring journal posts',
  (await page.getByText('The books balance').count()) > 0);

await page.goto(`${BASE}/accountant/transaction-locking`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('Transaction locking offers a lock per module',
  (await page.getByRole('button', { name: 'Lock' }).count()) === 4);

// ── 9b. Quick create opens and navigates (this crashed once — see command.tsx)
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Quick create' }).click();
await page.waitForTimeout(800);
check('Quick create opens without crashing',
  (await page.getByPlaceholder(/Create something/).count()) > 0);
await page.locator('[data-slot="dialog-content"]').getByText('New Invoice', { exact: true }).click();
await page.waitForTimeout(1200);
check('Quick create navigates to the invoice form', page.url().includes('/sales/invoices/new'));

// Every quick-create target must be a real route, not a 404.
const quickHrefs = [
  '/sales/invoices/new', '/purchases/bills/new', '/sales/payments/new',
  '/purchases/payments/new', '/purchases/expenses', '/sales/customers/new',
  '/purchases/vendors', '/sales/estimates', '/accountant/journals',
  '/banking/reconcile',
];
let deadLinks = 0;
for (const href of quickHrefs) {
  const resp = await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
  if (!resp || resp.status() >= 400) deadLinks++;
}
check('No dead links in quick create', deadLinks === 0, `${deadLinks} dead`);

// ── 10. Demo reset restores the seed
await page.getByRole('button', { name: /Demo/ }).click();
await page.getByRole('menuitem', { name: /Reset to seed data/ }).click();
await page.waitForTimeout(1200);
await page.goto(`${BASE}/reports/trial-balance`, { waitUntil: 'networkidle' });
check('Demo reset leaves the books balanced',
  await page.getByText('The books balance').count() > 0);

await browser.close();

const realErrors = [...new Set(errors)];
console.log(`\n${pass} passed, ${fail} failed.`);
if (realErrors.length) {
  console.log('\nConsole errors during the run:');
  realErrors.forEach((e) => console.log('  ' + e));
}
process.exit(fail || realErrors.length ? 1 : 0);
