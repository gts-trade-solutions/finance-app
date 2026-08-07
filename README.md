# Finora — interactive MVP

A clickable prototype of an India-first accounting product. **No backend, no database, no external APIs** — everything runs in the browser on dummy data so the whole feature set can be reviewed and approved before any server work begins.

```bash
npm install
npm run dev          # http://localhost:5000
```

Pick any user on the sign-in screen. Data is seeded automatically and persists in your browser's local storage. The **Demo** menu in the top bar resets it at any time.

---

## What makes this more than a mockup

Under the screens sits a real double-entry ledger. Every invoice, bill and payment you create posts a balanced journal entry, and the Trial Balance, Profit & Loss and Balance Sheet are computed live from those entries. Nothing is faked with hardcoded numbers.

- **The books always balance.** The posting engine (`lib/ledger/posting.ts`) rejects any entry whose debits and credits differ — by construction, not by checking afterwards.
- **Nothing is ever deleted.** Voiding a document posts an opposite, cancelling entry. Both stay visible. This is what Indian law requires of accounting software, and it falls out of the design rather than being bolted on.
- **The GST engine is real.** `lib/tax/gst.ts` resolves CGST+SGST vs IGST from the supplier's state and the place of supply, handles exports, SEZ, reverse charge and composition dealers, and validates GSTIN checksums. It is production code, not demo filler.
- **TDS thresholds actually accumulate.** Bill a contractor past ₹1,00,000 in a year and the app starts withholding tax automatically.

## A 5-minute walkthrough

1. **Sign in as Arun (Admin)** → the dashboard shows live receivables, cash position, profit, and compliance alerts.
2. **Sales → Invoices → New invoice.** Pick *Sharma Traders* (Tamil Nadu) and watch the tax panel resolve to **CGST + SGST**. Switch the customer to *Apex Motors* (Karnataka) and it flips to **IGST** — same goods, different tax, decided by geography.
3. Save it, then open the **Journal entry** tab on the invoice. That's the double-entry the customer never sees.
4. **Submit to IRP** on the invoice → after a pause an IRN and signed QR code are stamped on the document. Print it to see the tax invoice.
5. **Banking → Reconcile.** Two panes: bank lines on the left, suggested matches on the right. Use ↑ ↓ and Enter. The statement-vs-ledger delta at the top is the number that must reach zero.
6. **Reports → Trial Balance.** Debits equal credits to the paisa. Do anything you like in the app first — it will still balance.
7. **GST → ITC reconciliation.** Four buckets showing where input credit is safe, at risk, or being missed entirely.
8. **Purchases → MSME 45-day tracker.** Countdown on unpaid small-supplier bills, because paying them late costs a tax deduction.
9. **Demo menu → switch to Vikram (Sales).** Purchase costs, profit figures and whole modules disappear.

## Module map

| Area | What's in it |
|---|---|
| **Dashboard** | Cash, receivables, payables, profit, compliance alerts, AI flags |
| **Sales** | Customers · Items · Estimates · Sales orders · Delivery challans · Invoices · Retainers · Payments · Credit notes · Recurring & reminders |
| **Purchases** | Vendors · Expenses · Purchase orders · Bills (ITC / reverse charge / TDS) · Payment runs · Vendor credits · MSME tracker |
| **Banking** | Accounts · Reconciliation workspace · CSV import & feeds · Rules · Transfers · Cheques & PDCs |
| **Accountant** | Manual journals · Chart of accounts · Opening balances · Budgets · Period close · Audit trail |
| **GST & taxes** | E-invoices (IRP) · E-way bills · GSTR-1 · GSTR-3B with set-off · ITC reconciliation · TDS & TCS |
| **Inventory** | Stock on hand · Adjustments · Warehouses |
| **Reports** | 14 reports, all derived live from journal entries, all exportable |
| **AI assistant** | Ask questions · Scan a document · What needs attention |
| **Settings** | Organisation · Users & roles · Numbering · Custom fields · Automation · Integrations · Developer API |
| **Portal** | Customer-facing view at `/portal` |

## How it's put together

```
app/(app)/…          screens, grouped by module
app/login            role picker
app/portal           customer-facing surface
components/
  ui/                shadcn (Base UI) primitives
  shared/            money, tables, report shell, journal table…
  forms/ layout/ print/ charts/
lib/
  ledger/posting.ts  the only writer of journal entries
  ledger/reports.ts  TB / P&L / BS / GL — pure functions
  tax/gst.ts         supply-type resolver + GSTIN checksum
  tax/tds.ts         section master + threshold logic
  services/          the future API surface, mock-backed today
  store/             one Zustand store, persisted
  mock/seed/         the demo dataset, built via the real services
  mock/simulators.ts fake IRP, bank feed, OCR, assistant
```

Money is stored as **integer paise** throughout and formatted with Indian digit grouping. No floating-point arithmetic touches a rupee value anywhere.

## Simulated, not real

The IRP, e-way bill portal, bank feeds, payment gateway, OCR and the assistant are all simulated locally with realistic delays and failure paths — one invoice deliberately gets rejected by the fake IRP so the retry flow is visible. Swapping these for real integrations is backend work, and each already sits behind a single function.

## Not built yet

Payroll, manufacturing, fixed-asset depreciation, multi-currency and multi-entity consolidation are deliberately out of scope. See the approved plan for the reasoning.
