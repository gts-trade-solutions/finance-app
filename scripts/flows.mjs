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
// Select triggers on this form, in DOM order: 0 customer, 1 branch,
// 2 place of supply, 3 line-item, 4 line GST rate.
const sel = (n) => page.locator('[data-slot="select-trigger"]').nth(n);

await page.goto(`${BASE}/sales/invoices/new`, { waitUntil: 'networkidle' });
await sel(0).click();
await page.getByRole('option', { name: /Sharma Traders/ }).click();
await page.waitForTimeout(500);
const intraLabel = await page.getByText('Intra-state — CGST + SGST').count();
check('Tamil Nadu customer resolves to CGST + SGST', intraLabel > 0);

await sel(0).click();
await page.getByRole('option', { name: /Apex Motors/ }).click();
await page.waitForTimeout(500);
const interLabel = await page.getByText('Inter-state — IGST').count();
check('Karnataka customer flips to IGST', interLabel > 0);

// ── 4. Create an invoice and confirm it posts a balanced journal entry
await sel(3).click();
await page.getByRole('option', { name: /Brake Pad Set/ }).click();
await page.waitForTimeout(500);
const totalTxt = await page.locator('text=Total').last().locator('xpath=..').innerText().catch(() => '');
check('Totals panel computes a non-zero total', money(totalTxt) > 0, totalTxt.replace(/\n/g, ' ').slice(0, 40));

await page.getByRole('button', { name: /^Save$/ }).click();
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

// ── 9. AI assistant answers from the live ledger
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Demo/ }).click();
await page.getByRole('menuitem', { name: /Arun Kumar/ }).click();
await page.waitForTimeout(600);
await page.goto(`${BASE}/ai`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Which invoices are overdue?' }).click();
await page.waitForTimeout(2500);
check('Assistant answers a ledger question',
  await page.getByText(/invoices are overdue, totalling/).count() > 0);

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
