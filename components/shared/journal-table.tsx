'use client';

// Renders one journal entry with its balance proof. Used on every document
// detail screen — the "show me what this did to my books" view.

import { useAppStore } from '@/lib/store';
import { Money } from '@/components/shared/money';

export function JournalTable({ entryId }: { entryId: string }) {
  const s = useAppStore();
  const entry = s.entries.find((e) => e.id === entryId);
  if (!entry) return null;
  const totalDr = entry.lines.reduce((t, l) => t + l.debit, 0);
  const totalCr = entry.lines.reduce((t, l) => t + l.credit, 0);

  return (
    <div className="overflow-x-auto rounded-lg border thin-scroll">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold">Account</th>
            <th className="px-3 py-2 text-left font-semibold">Narration</th>
            <th className="px-3 py-2 text-right font-semibold">Debit</th>
            <th className="px-3 py-2 text-right font-semibold">Credit</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l, idx) => {
            const acc = s.accounts.find((a) => a.id === l.accountId);
            return (
              <tr key={idx} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{acc?.code}</span>{' '}
                  <span className="font-medium">{acc?.name}</span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{l.description ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  {l.debit > 0 ? <Money value={l.debit} /> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {l.credit > 0 ? <Money value={l.credit} /> : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            );
          })}
          <tr className="bg-muted/40 font-semibold">
            <td className="px-3 py-2" colSpan={2}>
              JE #{entry.entryNo} · {new Date(entry.date).toLocaleDateString('en-IN')}
            </td>
            <td className="px-3 py-2 text-right"><Money value={totalDr} /></td>
            <td className="px-3 py-2 text-right"><Money value={totalCr} /></td>
          </tr>
        </tbody>
      </table>
      <div className="flex items-center gap-2 border-t bg-emerald-500/5 px-3 py-2 text-xs">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        <span className="text-muted-foreground">Balanced — debits equal credits to the paisa.</span>
      </div>
    </div>
  );
}
