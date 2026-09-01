'use client';

// Opening balances — where the books start.
//
// A business does not begin the day it starts using accounting software. What
// it already had on day one is carried forward as one balanced journal, with
// Opening Balance Equity as the contra: that account is not real equity, it is
// a holding bucket that nets to nothing once every opening figure is in.

import { FileCheck2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { Money } from '@/components/shared/money';
import { JournalEntryTable } from '@/components/shared/journal-table';
import { EmptyState } from '@/components/shared/empty-state';
import { AsyncPage } from '@/components/shared/async-state';
import { journal, type JournalResponse } from '@/lib/api/client';
import { useApi } from '@/lib/api/use-api';

export default function OpeningBalancesPage() {
  const state = useApi<JournalResponse>(() => journal.list({ sourceType: 'opening', limit: 50 }), []);

  return (
    <>
      <PageHeader
        title="Opening balances"
        description="Where the books start. Everything the business already owned and owed on day one of the financial year."
      />

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <FileCheck2 className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">What opening balances are for</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            A business doesn&apos;t begin the day it starts using accounting software. When you migrate — from
            Tally, from spreadsheets, from a previous year — you carry forward what you already had: cash in the
            bank, stock on the shelves, money customers still owe you, and loans outstanding. That carry-forward is
            entered as a single balanced journal so the new books continue the story rather than starting a new one.
          </p>
        </div>
      </Card>

      <AsyncPage state={state}>
        {(d) =>
          d.entries.length === 0 ? (
            <EmptyState
              icon={FileCheck2}
              title="No opening balances entered"
              description="Opening balances are posted as a single balanced journal at the start of the financial year."
            />
          ) : (
            <>
              {d.entries.map((e) => (
                <Card key={e.id} className="space-y-3 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{e.memo}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Journal entry #{e.entryNo} ·{' '}
                        {new Date(e.date).toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'long', year: 'numeric',
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-emerald-500/40 text-[10px]">Balanced</Badge>
                      <Money value={e.totalDebitPaise} className="text-lg font-semibold" />
                    </div>
                  </div>
                  <JournalEntryTable entry={e} />
                </Card>
              ))}
            </>
          )
        }
      </AsyncPage>
    </>
  );
}
