import {
  Banknote, BarChart3, BookOpen, Boxes, Bot, Building2, CreditCard, FileSpreadsheet,
  FileText, Landmark, LayoutDashboard, type LucideIcon, Package, Receipt,
  ReceiptIndianRupee, Repeat, ScrollText, Settings, ShieldCheck, ShoppingCart,
  Truck, Users, Wallet, FileCheck2, HandCoins, ClipboardList, CalendarClock,
  FileMinus, FileClock, Building, AlertTriangle, ArrowLeftRight, Split,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** RBAC module key checked with hasPermission(role, module, 'view'). */
  module: string;
  badge?: 'einvoicePending' | 'msmeRisk' | 'unmatched';
}

export interface NavGroup {
  label: string;
  icon: LucideIcon;
  module: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Sales',
    icon: ReceiptIndianRupee,
    module: 'sales',
    items: [
      { label: 'Customers', href: '/sales/customers', icon: Users, module: 'sales' },
      { label: 'Items', href: '/sales/items', icon: Package, module: 'sales' },
      { label: 'Estimates', href: '/sales/estimates', icon: FileText, module: 'sales' },
      { label: 'Sales Orders', href: '/sales/sales-orders', icon: ClipboardList, module: 'sales' },
      { label: 'Delivery Challans', href: '/sales/challans', icon: Truck, module: 'sales' },
      { label: 'Invoices', href: '/sales/invoices', icon: Receipt, module: 'sales' },
      { label: 'Retainer Invoices', href: '/sales/retainers', icon: HandCoins, module: 'sales' },
      { label: 'Payments Received', href: '/sales/payments', icon: Wallet, module: 'sales' },
      { label: 'Credit Notes', href: '/sales/credit-notes', icon: FileMinus, module: 'sales' },
      { label: 'Recurring Invoices', href: '/sales/recurring', icon: Repeat, module: 'sales' },
    ],
  },
  {
    label: 'Purchases',
    icon: ShoppingCart,
    module: 'purchases',
    items: [
      { label: 'Vendors', href: '/purchases/vendors', icon: Building2, module: 'purchases' },
      { label: 'Expenses', href: '/purchases/expenses', icon: CreditCard, module: 'purchases' },
      { label: 'Purchase Orders', href: '/purchases/purchase-orders', icon: ClipboardList, module: 'purchases' },
      { label: 'Bills', href: '/purchases/bills', icon: FileText, module: 'purchases' },
      { label: 'Payments Made', href: '/purchases/payments', icon: Banknote, module: 'purchases' },
      { label: 'Vendor Credits', href: '/purchases/vendor-credits', icon: FileMinus, module: 'purchases' },
      { label: 'MSME 45-Day Tracker', href: '/purchases/msme-tracker', icon: AlertTriangle, module: 'purchases', badge: 'msmeRisk' },
    ],
  },
  {
    label: 'Banking',
    icon: Landmark,
    module: 'banking',
    items: [
      { label: 'Accounts', href: '/banking/accounts', icon: Landmark, module: 'banking' },
      { label: 'Reconcile', href: '/banking/reconcile', icon: Split, module: 'banking', badge: 'unmatched' },
      { label: 'Imports & Feeds', href: '/banking/imports', icon: FileSpreadsheet, module: 'banking' },
      { label: 'Bank Rules', href: '/banking/rules', icon: ScrollText, module: 'banking' },
      { label: 'Transfers', href: '/banking/transfers', icon: ArrowLeftRight, module: 'banking' },
      { label: 'Cheques & PDC', href: '/banking/cheques', icon: FileClock, module: 'banking' },
    ],
  },
  {
    label: 'Accountant',
    icon: BookOpen,
    module: 'accountant',
    items: [
      { label: 'Manual Journals', href: '/accountant/journals', icon: BookOpen, module: 'accountant' },
      { label: 'Chart of Accounts', href: '/accountant/chart-of-accounts', icon: ScrollText, module: 'accountant' },
      { label: 'Opening Balances', href: '/accountant/opening-balances', icon: FileCheck2, module: 'accountant' },
      { label: 'Budgets', href: '/accountant/budgets', icon: BarChart3, module: 'accountant' },
      { label: 'Period Close', href: '/accountant/period-close', icon: CalendarClock, module: 'accountant' },
      { label: 'Audit Trail', href: '/accountant/audit-trail', icon: ShieldCheck, module: 'accountant' },
    ],
  },
  {
    label: 'GST & Taxes',
    icon: ShieldCheck,
    module: 'gst',
    items: [
      { label: 'E-Invoices (IRP)', href: '/gst/einvoices', icon: FileCheck2, module: 'gst', badge: 'einvoicePending' },
      { label: 'E-Way Bills', href: '/gst/eway-bills', icon: Truck, module: 'gst' },
      { label: 'GSTR-1', href: '/gst/gstr1', icon: FileText, module: 'gst' },
      { label: 'GSTR-3B', href: '/gst/gstr3b', icon: FileSpreadsheet, module: 'gst' },
      { label: 'ITC Reconciliation (2B)', href: '/gst/itc-reconciliation', icon: Split, module: 'gst' },
      { label: 'TDS & TCS', href: '/gst/tds-tcs', icon: Receipt, module: 'gst' },
    ],
  },
  {
    label: 'Inventory',
    icon: Boxes,
    module: 'inventory',
    items: [
      { label: 'Stock on Hand', href: '/inventory/stock', icon: Boxes, module: 'inventory' },
      { label: 'Adjustments', href: '/inventory/adjustments', icon: ClipboardList, module: 'inventory' },
      { label: 'Warehouses', href: '/inventory/warehouses', icon: Building, module: 'inventory' },
    ],
  },
];

export const TOP_LEVEL: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, module: 'sales' },
];

export const BOTTOM_LEVEL: NavItem[] = [
  { label: 'Reports', href: '/reports', icon: BarChart3, module: 'reports' },
  { label: 'AI Assistant', href: '/ai', icon: Bot, module: 'ai' },
  { label: 'Settings', href: '/settings', icon: Settings, module: 'settings' },
];
