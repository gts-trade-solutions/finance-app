'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
  href?: string;
}) {
  const toneRing = {
    default: 'text-primary bg-primary/10',
    positive: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
    warning: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
    danger: 'text-red-600 dark:text-red-400 bg-red-500/10',
  }[tone];

  const body = (
    <Card className={cn('p-4 transition-colors', href && 'hover:border-primary/40 hover:bg-accent/40')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {Icon && (
          <div className={cn('rounded-lg p-2', toneRing)}>
            <Icon className="size-4" />
          </div>
        )}
      </div>
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
