'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Banknote, CheckCircle2, Clock, FileCheck2, Landmark,
  Lock, Package, Receipt, ShieldAlert, TrendingUp, Wallet, Wrench, XCircle,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { DateRangePicker } from '@/components/shared/date-range-picker';
import { StatTile } from '@/components/shared/stat-tile';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { ShareDonut } from '@/components/charts/share-donut';
import { RankedBars } from '@/components/charts/ranked-bars';
import { useAppStore } from '@/lib/store';
import { useCanSeeCosts } from '@/lib/store/hooks';
import {
  cashPosition, contactName, effectiveInvoiceStatus, invoiceBalance, monthlySeries,
  msmeTracker, openInvoices, overdueReceivable, today,
  totalCash, totalPayable, totalReceivable,
} from '@/lib/selectors';
import {
  billedVsCollected, goodsVsServices, grossMargin, pctChange, previousWindow,
  receivableBuckets, salesPerformance, topCreditors, topDebtors, type Window,
} from '@/lib/analytics';
import { describeRange, fromPreset, type RangeValue } from '@/lib/date-range';
import { formatINR, formatINRCompact } from '@/lib/money';
import { profitAndLoss, trialBalance } from '@/lib/ledger/reports';
import { detectAnomalies } from '@/lib/mock/simulators';
import { CHART_COLORS, axisProps, axisRupee, rupeeFormatter, tooltipStyle } from '@/components/charts/chart-bits';

export default function DashboardPage() {
  const s = useAppStore();
  const canSeeCosts = useCanSeeCosts();
  // Same picker the lists and reports use, so "last quarter" means the same
  // thing everywhere in the app.
  const [range, setRange] = useState<RangeValue>(() => fromPreset('last_90', today()));

  const fyStart = s.org?.fiscalYearStart ?? '2026-04-01';

  const stats = useMemo(() => {
    const pl = profitAndLoss(s.accounts, s.entries, { from: fyStart, to: today() });
    return {
      receivable: totalReceivable(s),
      overdue: overdueReceivable(s),
      payable: totalPayable(s),
      cash: totalCash(s),
      pl,
      tb: trialBalance(s.accounts, s.entries),
    };
  }, [s, fyStart]);

  // ── Sales block: the chosen window, and the one immediately before it ──────
  const win = useMemo<Window>(() => ({ from: range.from, to: range.to }), [range]);
  const prev = useMemo(() => previousWindow(win), [win]);
  const perf = useMemo(() => salesPerformance(s, win), [s, win]);
  const perfPrev = useMemo(() => salesPerformance(s, prev), [s, prev]);
  const margin = useMemo(() => grossMargin(s, win), [s, win]);
  const mix = useMemo(() => goodsVsServices(s, win), [s, win]);

  const series = useMemo(() => monthlySeries(s, 6), [s]);
  const bvc = useMemo(() => billedVsCollected(s, 6), [s]);
  const debtors = useMemo(() => topDebtors(s, 6), [s]);
  const creditors = useMemo(() => topCreditors(s, 6), [s]);
  const buckets = useMemo(() => receivableBuckets(s), [s]);
  // detectAnomalies reads the store directly, so `s` is the dependency that
  // tells us the underlying data changed even though it isn't referenced here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const anomalies = useMemo(() => detectAnomalies().slice(0, 4), [s]);
  const msme = useMemo(() => msmeTracker(s).filter((m) => m.risk !== 'ok'), [s]);
  const cash = useMemo(() => cashPosition(s), [s]);

  const recentInvoices = [...s.invoices]
    .filter((i) => i.status !== 'draft')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  const einvoicePending = s.invoices.filter(
    (i) => i.einvoice.status === 'pending' || i.einvoice.status === 'failed',
  ).length;
  const unmatched = s.bankTxns.filter((t) => t.status === 'unmatched').length;

  const expenseMix = useMemo(
    () =>
      stats.pl.expenseRows.slice(0, 6).map((r) => ({
        name: r.account.name.length > 24 ? `${r.account.name.slice(0, 22)}…` : r.account.name,
        value: r.amount,
      })),
    [stats.pl],
  );

  const periodLabel = describeRange(range).toLowerCase();
  const statusTotal = perf.paid + perf.partial + perf.unpaid;
  const sharePct = (n: number) => (statusTotal ? ((n / statusTotal) * 100).toFixed(0) : '0');

  return (
    <>
      <PageHeader
        title={`Good day, ${s.users.find((u) => u.id === s.session?.userId)?.name.split(' ')[0]}`}
        description={`${s.org?.name} · ${s.org?.fiscalYearLabel} · figures shown as at ${new Date(today()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports">View reports</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/sales/invoices/new">New invoice</Link>
            </Button>
          </>
        }
      />

      {/* Compliance alert strip — the India-specific value, front and centre */}
      {(einvoicePending > 0 || msme.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {einvoicePending > 0 && (
            <Link href="/gst/einvoices">
              <Card className="flex items-center gap-3 border-amber-500/40 bg-amber-500/5 p-3.5 transition-colors hover:bg-amber-500/10">
                <FileCheck2 className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{einvoicePending} invoice(s) awaiting IRN</p>
                  <p className="text-xs text-muted-foreground">
                    B2B invoices are not legally valid without an IRN. A 30-day reporting window applies.
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Card>
            </Link>
          )}
          {msme.length > 0 && (
            <Link href="/purchases/msme-tracker">
              <Card className="flex items-center gap-3 border-red-500/40 bg-red-500/5 p-3.5 transition-colors hover:bg-red-500/10">
                <AlertTriangle className="size-5 shrink-0 text-red-600 dark:text-red-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{msme.length} MSME bill(s) near the 45-day limit</p>
                  <p className="text-xs text-muted-foreground">
                    Section 43B(h) disallows the expense if MSME vendors aren’t paid within 45 days.
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Card>
            </Link>
          )}
        </div>
      )}

      {/* Headline numbers — position, not performance */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Receivables"
          value={formatINRCompact(stats.receivable)}
          sub={`${openInvoices(s).length} open invoices · ${formatINRCompact(stats.overdue)} overdue`}
          icon={Receipt}
          tone={stats.overdue > 0 ? 'warning' : 'default'}
          href="/reports/ar-ageing"
        />
        <StatTile
          label="Payables"
          value={formatINRCompact(stats.payable)}
          sub="Bills awaiting payment"
          icon={Banknote}
          href="/reports/ap-ageing"
        />
        <StatTile
          label="Cash & Bank"
          value={formatINRCompact(stats.cash)}
          sub={`Across ${cash.length} accounts`}
          icon={Landmark}
          tone="positive"
          href="/banking"
        />
        <StatTile
          label={stats.pl.netProfit >= 0 ? 'Profit (YTD)' : 'Loss (YTD)'}
          value={formatINRCompact(Math.abs(stats.pl.netProfit))}
          sub={`Income ${formatINRCompact(stats.pl.totalIncome)} − expenses ${formatINRCompact(stats.pl.totalExpense)}`}
          icon={TrendingUp}
          tone={stats.pl.netProfit >= 0 ? 'positive' : 'danger'}
          href="/reports/profit-and-loss"
        />
      </div>

      {/* ── Sales performance ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-5">
        <div>
          <h2 className="text-sm font-semibold">Sales performance</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date(win.from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            {' – '}
            {new Date(win.to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            {', compared with the '}
            {periodLabel}
            {' before it. Draft invoices are excluded throughout.'}
          </p>
        </div>
        <DateRangePicker
          value={range}
          onChange={setRange}
          dataDates={s.invoices.map((i) => i.date)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total billed"
          value={formatINRCompact(perf.billed)}
          delta={pctChange(perf.billed, perfPrev.billed)}
          sub={`${perf.invoiceCount} invoices · ${perf.customerCount} customers`}
          icon={Receipt}
          href="/reports/invoice-details"
        />
        <StatTile
          label="Collected"
          value={formatINRCompact(perf.collected)}
          delta={pctChange(perf.collected, perfPrev.collected)}
          sub="Cash actually received in the period"
          icon={Wallet}
          tone="positive"
          href="/reports/payments-received"
        />
        <StatTile
          label="Outstanding"
          value={formatINRCompact(perf.outstanding)}
          delta={pctChange(perf.outstanding, perfPrev.outstanding)}
          deltaGoodWhen="down"
          sub="Still unpaid, from invoices raised in the period"
          icon={Clock}
          tone={perf.outstanding > 0 ? 'warning' : 'default'}
          href="/reports/ar-ageing"
        />
        <StatTile
          label="Average invoice"
          value={formatINRCompact(perf.avgInvoice)}
          delta={pctChange(perf.avgInvoice, perfPrev.avgInvoice)}
          sub={`Across ${perf.invoiceCount} invoices`}
          icon={TrendingUp}
        />
      </div>

      {/* Invoice status split — counts and shares */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Paid', count: perf.paid, icon: CheckCircle2, klass: 'border-emerald-500/40 bg-emerald-500/5', ink: 'text-emerald-600 dark:text-emerald-400', hint: 'settled in full' },
          { label: 'Partly paid', count: perf.partial, icon: Clock, klass: 'border-amber-500/40 bg-amber-500/5', ink: 'text-amber-600 dark:text-amber-400', hint: 'part payment received' },
          { label: 'Unpaid', count: perf.unpaid, icon: XCircle, klass: 'border-red-500/40 bg-red-500/5', ink: 'text-red-600 dark:text-red-400', hint: 'nothing received yet' },
        ].map((b) => (
          <Card key={b.label} className={`flex items-center gap-3 p-4 ${b.klass}`}>
            <div className="min-w-0 flex-1">
              <p className="micro-label">{b.label}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="tabular text-2xl font-semibold">{b.count}</span>
                <span className="tabular text-xs text-muted-foreground">{sharePct(b.count)}% of {statusTotal}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{b.hint}</p>
            </div>
            <b.icon className={`size-5 shrink-0 ${b.ink}`} />
          </Card>
        ))}
      </div>

      {/*
        Gross margin is owner-only because it exposes what we pay for stock.
        It is also explicitly *indicative*: purchases are expensed when billed
        rather than valued into inventory, so this figure will not tie to the
        Profit and Loss and is not meant to. Saying so on the card itself is
        cheaper than fielding the question every month.
      */}
      {canSeeCosts && (
        <Card className="accent-bar p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Gross margin</h2>
                <Badge variant="outline" className="gap-1 text-[9px]">
                  <Lock className="size-2.5" /> Owner only
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Sales value less the catalogue purchase price of what went out the door.
              </p>
            </div>
            <TrendingUp className="size-5 text-emerald-600 dark:text-emerald-400" />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="micro-label">Gross margin</p>
              <p className="mt-1 tabular text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                {formatINR(margin.gross)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{margin.marginPct.toFixed(1)}% of sales</p>
            </div>
            <div>
              <p className="micro-label">Revenue (excl. GST)</p>
              <p className="mt-1 tabular text-lg font-medium">{formatINR(margin.revenue)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{perf.invoiceCount} invoices</p>
            </div>
            <div>
              <p className="micro-label">Cost of goods sold</p>
              <p className="mt-1 tabular text-lg font-medium">{formatINR(margin.cogs)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">purchase price of sold units</p>
            </div>
            <div>
              <p className="micro-label">Units sold</p>
              <p className="mt-1 tabular text-lg font-medium">{margin.units.toLocaleString('en-IN')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">in the period</p>
            </div>
          </div>

          <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2.5 text-xs">
            <span className="text-muted-foreground">Revenue </span>
            <span className="tabular font-medium">{formatINR(margin.revenue)}</span>
            <span className="text-muted-foreground"> − COGS </span>
            <span className="tabular font-medium">{formatINR(margin.cogs)}</span>
            <span className="text-muted-foreground"> = Gross margin </span>
            <span className="tabular font-medium text-emerald-600 dark:text-emerald-400">
              {formatINR(margin.gross)}
            </span>
            <span className="text-muted-foreground"> ({margin.marginPct.toFixed(1)}%)</span>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Indicative only — it will not agree with the Profit and Loss, because purchases are expensed when
            billed rather than valued into stock. Use it for pricing, not for filing.
            {margin.linesWithoutCost > 0 && (
              <> {margin.linesWithoutCost} line(s) have no cost price on file, so the margin is flattered by that much.</>
            )}
          </p>
        </Card>
      )}

      {/* Billed vs collected, and what we actually sell */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-4">
            <h2 className="text-sm font-semibold">Billed vs collected</h2>
            <p className="text-xs text-muted-foreground">
              Last 6 months. The gap between the two bars is the money you have earned but not yet been paid.
            </p>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={bvc} margin={{ left: -10, right: 8, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis tickFormatter={axisRupee} {...axisProps} width={64} />
              <Tooltip formatter={rupeeFormatter} cursor={{ fill: 'var(--accent)' }} contentStyle={tooltipStyle} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="billed" name="Billed" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="collected" name="Collected" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold">Goods vs services</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Taxable value for the {periodLabel}. Services carry a SAC, goods an HSN.
          </p>
          <ShareDonut
            data={mix.map((m) => ({ name: m.label, value: m.value }))}
            centreLabel="Taxable"
            emptyMessage="No invoices in this period."
          />
          <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Package className="size-3.5" /> {mix[0].lines} goods lines
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Wrench className="size-3.5" /> {mix[1].lines} service lines
            </div>
          </div>
        </Card>
      </div>

      {/* Trend + expense mix */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-4">
            <h2 className="text-sm font-semibold">Sales vs expenses</h2>
            <p className="text-xs text-muted-foreground">Last 6 months, excluding GST</p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series} margin={{ left: -10, right: 8, top: 4 }}>
              <defs>
                <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis tickFormatter={axisRupee} {...axisProps} width={64} />
              <Tooltip formatter={rupeeFormatter} contentStyle={tooltipStyle} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="sales" name="Sales" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gSales)" />
              <Area type="monotone" dataKey="expenses" name="Expenses" stroke="var(--chart-5)" strokeWidth={2} fill="url(#gExp)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold">Where the money goes</h2>
          <p className="mb-3 text-xs text-muted-foreground">Top expense accounts, year to date</p>
          <ShareDonut data={expenseMix} centreLabel="Expenses" emptyMessage="No expenses posted yet." />
        </Card>
      </div>

      {/* ── Debtors and creditors, side by side ───────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Who owes us the most</h2>
              <p className="text-xs text-muted-foreground">
                Debtors — customers with an unpaid balance. Share of total receivables.
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/reports/customer-balances">All <ArrowRight className="ml-1 size-3.5" /></Link>
            </Button>
          </div>
          <RankedBars
            rows={debtors.map((d) => ({
              id: d.contactId,
              name: d.name,
              value: d.value,
              pct: d.pct,
              alert: d.overdue > 0,
              href: `/reports/ar-ageing`,
              note:
                d.overdue > 0
                  ? `${formatINR(d.overdue)} of this is past due · ${d.count} invoice(s)`
                  : `${d.count} invoice(s), none past due`,
            }))}
            emptyMessage="Nobody owes you anything. Enviable."
          />
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Who we owe the most</h2>
              <p className="text-xs text-muted-foreground">
                Creditors — suppliers with an unpaid bill. Share of total payables.
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/reports/vendor-balances">All <ArrowRight className="ml-1 size-3.5" /></Link>
            </Button>
          </div>
          <RankedBars
            tone="warning"
            rows={creditors.map((c) => ({
              id: c.contactId,
              name: c.name,
              value: c.value,
              pct: c.pct,
              alert: c.overdue > 0,
              href: `/reports/ap-ageing`,
              note:
                c.overdue > 0
                  ? `${formatINR(c.overdue)} of this is overdue · ${c.count} bill(s)`
                  : `${c.count} bill(s), none overdue`,
            }))}
            emptyMessage="You owe nobody anything."
          />
        </Card>
      </div>

      {/* Ageing buckets, with each bucket's share */}
      <Card className="p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Outstanding by age</h2>
            <p className="text-xs text-muted-foreground">
              How long the money has been owed. Anything past 60 days is usually a collections problem, not a
              timing one.
            </p>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/reports/ar-ageing">Full ageing <ArrowRight className="ml-1 size-3.5" /></Link>
          </Button>
        </div>
        <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {buckets.map((b, i) => (
            <div key={b.bucket}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {b.bucket === 'Current' ? 'Current (not yet due)' : `${b.bucket} days overdue`}
                </span>
                <span className="shrink-0 tabular text-xs font-medium">{formatINR(b.value)}</span>
                <span className="w-11 shrink-0 text-right tabular text-[11px] text-muted-foreground">
                  {b.pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(b.value > 0 ? 2 : 0, b.pct)}%`,
                    background: CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{b.count} invoice(s)</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent invoices */}
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent invoices</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/sales/invoices">View all <ArrowRight className="ml-1 size-3.5" /></Link>
            </Button>
          </div>
          <div className="divide-y">
            {recentInvoices.map((inv) => (
              <Link
                key={inv.id}
                href={`/sales/invoices/${inv.id}`}
                className="flex items-center gap-3 py-2.5 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{contactName(s, inv.customerId)}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.number} · {new Date(inv.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </p>
                </div>
                <StatusBadge status={effectiveInvoiceStatus(inv)} />
                <Money value={invoiceBalance(inv)} className="w-28 text-sm font-medium" />
              </Link>
            ))}
          </div>
        </Card>

        {/* Attention needed */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
            <h2 className="text-sm font-semibold">Needs your attention</h2>
          </div>
          <div className="space-y-2.5">
            {anomalies.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing flagged. Books look clean.</p>
            )}
            {anomalies.map((a) => (
              <div key={a.id} className="rounded-md border p-2.5">
                <div className="flex items-start gap-2">
                  <span
                    className={
                      'mt-1 size-1.5 shrink-0 rounded-full ' +
                      (a.severity === 'high' ? 'bg-red-500' : a.severity === 'medium' ? 'bg-amber-500' : 'bg-muted-foreground')
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{a.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{a.detail}</p>
                  </div>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href="/ai">Open AI assistant</Link>
            </Button>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Bank & cash</h2>
          <div className="space-y-2">
            {cash.map((c) => (
              <div key={c.accountId} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 truncate text-muted-foreground">
                  <Wallet className="size-3.5 shrink-0" />
                  <span className="truncate">{c.name}</span>
                </span>
                <Money value={c.balance} className="font-medium" />
              </div>
            ))}
          </div>
          {unmatched > 0 && (
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <Link href="/banking/reconcile">{unmatched} lines to reconcile</Link>
            </Button>
          )}
        </Card>

        {/* The proof point for accountants */}
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-start gap-2.5">
            <FileCheck2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Books are balanced</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.entries.length} journal entries · debits and credits agree to the paisa.
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <Badge variant="outline" className="gap-1 border-emerald-500/40">
                  Dr <Money value={stats.tb.totalDebit} compact />
                </Badge>
                <Badge variant="outline" className="gap-1 border-emerald-500/40">
                  Cr <Money value={stats.tb.totalCredit} compact />
                </Badge>
              </div>
              <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" asChild>
                <Link href="/reports/trial-balance">Open trial balance →</Link>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
