'use client';

// Lightweight sortable/filterable table used by every list screen.
// Deliberately dependency-free so the demo stays fast and predictable.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface TableTab {
  value: string;
  label: string;
  count?: number;
}

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  /** Value used for sorting/searching (string or number). */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
}

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  onRowClick,
  searchPlaceholder = 'Search…',
  searchable = true,
  emptyMessage = 'Nothing to show yet.',
  toolbar,
  footer,
  initialSort,
  dense = false,
  tabs,
  activeTab,
  onTabChange,
  selectable = false,
  bulkActions,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchPlaceholder?: string;
  searchable?: boolean;
  emptyMessage?: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  dense?: boolean;
  /** Zoho-style status tabs above the table. */
  tabs?: TableTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  /** Adds a checkbox column and a bulk action bar when rows are selected. */
  selectable?: boolean;
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);

  const searchText = (row: T) =>
    columns
      .map((c) => (c.sortValue ? String(c.sortValue(row)) : ''))
      .join(' ')
      .toLowerCase();

  const filtered = useMemo(() => {
    let out = rows;
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) => searchText(r).includes(q));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortValue) {
        out = [...out].sort((a, b) => {
          const va = col.sortValue!(a);
          const vb = col.sortValue!(b);
          const cmp = typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb));
          return sort.dir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sort, columns]);

  // Selecting rows then changing the filter would act on invisible records.
  useEffect(() => setSelected(new Set()), [activeTab, query]);

  const visibleIds = filtered.map(getRowId);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectedRows = filtered.filter((r) => selected.has(getRowId(r)));
  const clearSelection = () => setSelected(new Set());

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(visibleIds));

  const toggleOne = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSort = (key: string) => {
    setSort((s) =>
      s?.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  return (
    <div className="space-y-3">
      {tabs && tabs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b no-print">
          {tabs.map((t) => {
            const isActive = (activeTab ?? tabs[0].value) === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => onTabChange?.(t.value)}
                className={cn(
                  '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors',
                  isActive
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
                {t.count != null && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px text-[10px] tabular',
                      isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selectable && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 no-print">
          <span className="text-[13px] font-medium">
            {selectedRows.length} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {bulkActions?.(selectedRows, clearSelection)}
          </div>
          <Button variant="ghost" size="xs" onClick={clearSelection} className="ml-auto gap-1">
            <X className="size-3" /> Clear
          </Button>
        </div>
      )}

      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 no-print">
          {searchable && (
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8"
              />
            </div>
          )}
          {toolbar}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border thin-scroll">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
              )}
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn(
                    'whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    c.sortValue && 'cursor-pointer select-none',
                    c.headerClassName,
                  )}
                  onClick={c.sortValue ? () => toggleSort(c.key) : undefined}
                >
                  <span className={cn('inline-flex items-center gap-1', c.align === 'right' && 'flex-row-reverse')}>
                    {c.header}
                    {c.sortValue &&
                      (sort?.key === c.key ? (
                        sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-30" />
                      ))}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (selectable ? 1 : 0)} className="h-28 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    onRowClick && 'cursor-pointer',
                    dense && '[&>td]:py-1.5',
                    selected.has(getRowId(row)) && 'bg-primary/5',
                  )}
                >
                  {selectable && (
                    <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label="Select row"
                        checked={selected.has(getRowId(row))}
                        onCheckedChange={() => toggleOne(getRowId(row))}
                      />
                    </TableCell>
                  )}
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        'whitespace-nowrap',
                        c.align === 'right' && 'text-right',
                        c.align === 'center' && 'text-center',
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {footer}
      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground no-print">
          {filtered.length} of {rows.length} record{rows.length === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}
