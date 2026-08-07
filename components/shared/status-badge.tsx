'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const TONES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground border-transparent',
  approved: 'bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/25',
  sent: 'bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/25',
  open: 'bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/25',
  issued: 'bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/25',
  partially_paid: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  partially_invoiced: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  partially_applied: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  in_hand: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  deposited: 'bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/25',
  paid: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  cleared: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  accepted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  matched: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  submitted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  applied: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  invoiced: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  billed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  converted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  recorded: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  overdue: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  bounced: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  declined: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  mismatch: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  missing_in_2b: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  missing_in_books: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  void: 'bg-muted text-muted-foreground line-through border-transparent',
  cancelled: 'bg-muted text-muted-foreground border-transparent',
  expired: 'bg-muted text-muted-foreground border-transparent',
  excluded: 'bg-muted text-muted-foreground border-transparent',
  closed: 'bg-muted text-muted-foreground border-transparent',
  unmatched: 'bg-muted text-muted-foreground border-transparent',
  not_applicable: 'bg-muted text-muted-foreground border-transparent',
  written_off: 'bg-muted text-muted-foreground border-transparent',
  refunded: 'bg-muted text-muted-foreground border-transparent',
  returned: 'bg-muted text-muted-foreground border-transparent',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge
      variant="outline"
      className={cn('font-medium capitalize', TONES[status] ?? TONES.draft, className)}
    >
      {label}
    </Badge>
  );
}
