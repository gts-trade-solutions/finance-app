'use client';

import Link from 'next/link';
import {
  BarChart3, BookOpen, Boxes, Building2, CalendarClock, FileSpreadsheet, FileText,
  Landmark, type LucideIcon, Receipt, ScrollText, ShieldCheck, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';

interface ReportDef {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
  live?: boolean;
}

const GROUPS: { group: string; blurb: string; reports: ReportDef[] }[] = [
  {
    group: 'Business overview',
    blurb: 'The three statements every business and every lender asks for.',
    reports: [
      { title: 'Profit & Loss', href: '/reports/profit-and-loss', icon: TrendingUp, description: 'Did we make money over a period?', live: true },
      { title: 'Balance Sheet', href: '/reports/balance-sheet', icon: Landmark, description: 'What we own and owe, on a given date.', live: true },
      { title: 'Cash Flow', href: '/reports/cash-flow', icon: Wallet, description: 'Where cash actually came from and went.', live: true },
    ],
  },
  {
    group: 'Accounting',
    blurb: 'The raw books — every report here reads the same journal entries.',
    reports: [
      { title: 'Trial Balance', href: '/reports/trial-balance', icon: ScrollText, description: 'Proof the books balance, account by account.', live: true },
      { title: 'General Ledger', href: '/reports/general-ledger', icon: BookOpen, description: 'Every movement through one account.', live: true },
      { title: 'Day Book', href: '/reports/day-book', icon: CalendarClock, description: 'Everything that happened, in date order.', live: true },
      { title: 'Journal Report', href: '/reports/journal-report', icon: FileText, description: 'All journal entries with their source document.', live: true },
    ],
  },
  {
    group: 'Receivables & payables',
    blurb: 'Who owes you, who you owe, and how late everyone is.',
    reports: [
      { title: 'AR Ageing', href: '/reports/ar-ageing', icon: Receipt, description: 'Outstanding customer invoices by age bucket.', live: true },
      { title: 'AP Ageing', href: '/reports/ap-ageing', icon: FileSpreadsheet, description: 'Unpaid supplier bills by age bucket.', live: true },
      { title: 'Sales by Customer', href: '/reports/sales-by-customer', icon: Users, description: 'Revenue ranked by who generated it.', live: true },
      { title: 'Sales by Item', href: '/reports/sales-by-item', icon: Boxes, description: 'What actually sells, by value and quantity.', live: true },
      { title: 'Purchases by Vendor', href: '/reports/purchases-by-vendor', icon: Building2, description: 'Spending ranked by supplier.', live: true },
      { title: 'Expenses by Category', href: '/reports/expenses-by-category', icon: BarChart3, description: 'Where the money goes, by account.', live: true },
    ],
  },
  {
    group: 'Tax & compliance',
    blurb: 'Everything the GST portal and your CA will ask for.',
    reports: [
      { title: 'GSTR-1 Summary', href: '/gst/gstr1', icon: FileText, description: 'Outward supplies, section by section.', live: true },
      { title: 'GSTR-3B Summary', href: '/gst/gstr3b', icon: FileSpreadsheet, description: 'Monthly liability with input credit set-off.', live: true },
      { title: 'ITC Reconciliation', href: '/gst/itc-reconciliation', icon: ShieldCheck, description: 'Your books against the government’s GSTR-2B.', live: true },
      { title: 'TDS & TCS', href: '/gst/tds-tcs', icon: Receipt, description: 'Tax withheld, by section and vendor.', live: true },
      { title: 'Audit Trail', href: '/accountant/audit-trail', icon: ShieldCheck, description: 'Who changed what, and when. Never editable.', live: true },
    ],
  },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="No report data is stored anywhere. Every figure below is calculated live from your journal entries, which is why they can never disagree with each other."
      />

      {GROUPS.map((g) => (
        <section key={g.group} className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">{g.group}</h2>
            <p className="text-xs text-muted-foreground">{g.blurb}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.reports.map((r) => (
              <Link key={r.href} href={r.href}>
                <Card className="group h-full p-4 transition-all hover:border-primary/40 hover:shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-primary/10 p-2">
                      <r.icon className="size-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{r.title}</p>
                        {r.live && (
                          <Badge variant="outline" className="border-emerald-500/40 text-[9px] text-emerald-700 dark:text-emerald-300">
                            Live
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.description}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
