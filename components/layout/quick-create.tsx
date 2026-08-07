'use client';

import { useRouter } from 'next/navigation';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { NAV_GROUPS, BOTTOM_LEVEL, TOP_LEVEL } from './nav-config';
import {
  FileText, Receipt, Wallet, CreditCard, Users, Building2, Split, BookOpen,
} from 'lucide-react';

const CREATE_ACTIONS = [
  { label: 'New Invoice', href: '/sales/invoices/new', icon: Receipt },
  { label: 'New Bill', href: '/purchases/bills/new', icon: FileText },
  { label: 'Record Payment Received', href: '/sales/payments/new', icon: Wallet },
  { label: 'Record Expense', href: '/purchases/expenses/new', icon: CreditCard },
  { label: 'New Customer', href: '/sales/customers/new', icon: Users },
  { label: 'New Vendor', href: '/purchases/vendors/new', icon: Building2 },
  { label: 'New Manual Journal', href: '/accountant/journals/new', icon: BookOpen },
  { label: 'Reconcile Bank', href: '/banking/reconcile', icon: Split },
];

export function QuickCreate({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const allPages = [
    ...TOP_LEVEL,
    ...NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, label: `${g.label} › ${i.label}` }))),
    ...BOTTOM_LEVEL,
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Create something or jump to a screen…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Create">
          {CREATE_ACTIONS.map((a) => (
            <CommandItem key={a.href} onSelect={() => go(a.href)}>
              <a.icon className="mr-2 size-4" />
              {a.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Go to">
          {allPages.map((p) => (
            <CommandItem key={p.href} onSelect={() => go(p.href)}>
              <p.icon className="mr-2 size-4" />
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
