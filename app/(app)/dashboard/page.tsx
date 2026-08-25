'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  AlertTriangle, ArrowRight, Banknote, FileCheck2, Landmark, Receipt,
  ShieldAlert, TrendingUp, Wallet,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { StatTile } from '@/components/shared/stat-tile';
import { Money } from '@/components/shared/money';
import { StatusBadge } from '@/components/shared/status-badge';
import { useAppStore } from '@/lib/store';
import {
  cashPosition, contactName, effectiveInvoiceStatus, invoiceBalance, monthlySeries,
  msmeTracker, openInvoices, overdueReceivable, receivablesAgeing, today,
  totalCash, totalPayable, totalReceivable,
} from '@/lib/selectors';
import { formatINRCompact } from '@/lib/money';
import { profitAndLoss, trialBalance } from '@/lib/ledger/reports';
import { detectAnomalies } from '@/lib/mock/simulators';
import { CHART_COLORS, axisProps, axisRupee, rupeeFormatter, tooltipStyle } from '@/components/charts/chart-bits';

export default function DashboardPage() {
  const s = useAppStore();

  const stats = useMemo(() => {
    const pl = profitAndLoss(s.accounts, s.entries, {
      from: s.org?.fiscalYearStart ?? '2026-04-01',
      to: today(),
    });
    return {
      receivable: totalReceivable(s),
      overdue: overdueReceivable(s),
      payable: totalPayable(s),
      cash: totalCash(s),
      pl,
      tb: trialBalance(s.accounts, s.entries),
    };
  }, [s]);

  const series = useMemo(() => monthlySeries(s, 6), [s]);
  const ageing = useMemo(() => receivablesAgeing(s).slice(0, 6), [s]);
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
      stats.pl.expenseRows.slice(0, 5).map((r, idx) => ({
        name: r.account.name.length > 22 ? r.account.name.slice(0, 20) + '…' : r.account.name,
        value: r.amount / 100,
        fill: CHART_COLORS[idx % CHART_COLORS.length],
      })),
    [stats.pl],
  );

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

      {/* Headline numbers */}
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

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Sales vs expenses</h2>
              <p className="text-xs text-muted-foreground">Last 6 months, excluding GST</p>
            </div>
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
              <YAxis
                tickFormatter={axisRupee}
                {...axisProps}
                width={64}
              />
              <Tooltip
                formatter={rupeeFormatter}
                contentStyle={tooltipStyle}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="sales" name="Sales" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gSales)" />
              <Area type="monotone" dataKey="expenses" name="Expenses" stroke="var(--chart-5)" strokeWidth={2} fill="url(#gExp)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold">Where the money goes</h2>
          <p className="mb-3 text-xs text-muted-foreground">Top expense accounts, YTD</p>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={expenseMix} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
                {expenseMix.map((e, i) => (
                  <Cell key={i} fill={e.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={rupeeFormatter}
                contentStyle={tooltipStyle}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5">
            {expenseMix.map((e) => (
              <div key={e.name} className="flex items-center gap-2 text-xs">
                <span className="size-2.5 rounded-sm" style={{ background: e.fill }} />
                <span className="truncate text-muted-foreground">{e.name}</span>
                <span className="ml-auto num tabular">₹{e.value.toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Receivables ageing */}
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Who owes us the most</h2>
              <p className="text-xs text-muted-foreground">Outstanding by customer</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/reports/ar-ageing">Full ageing <ArrowRight className="ml-1 size-3.5" /></Link>
            </Button>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ageing.map((a) => ({ name: a.name.split(' ')[0], value: a.total / 100 }))} margin={{ left: -10, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis tickFormatter={axisRupee} {...axisProps} width={56} />
              <Tooltip
                formatter={rupeeFormatter}
                cursor={{ fill: 'var(--accent)' }}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="value" name="Outstanding" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
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

        {/* Cash accounts + ledger health */}
        <div className="space-y-4">
          <Card className="p-4">
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
              <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
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
      </div>
    </>
  );
}
