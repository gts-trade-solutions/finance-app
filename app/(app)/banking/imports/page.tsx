'use client';

import { useRef, useState } from 'react';
import Papa from 'papaparse';
import { Download, FileSpreadsheet, Loader2, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { Field } from '@/components/shared/form-bits';
import { useAppStore } from '@/lib/store';
import { importBankTxns } from '@/lib/services/banking';
import { fetchBankFeed } from '@/lib/mock/simulators';

/** A sample statement the user can download, edit and re-upload. */
const SAMPLE_CSV = `Date,Narration,Reference,Debit,Credit
2026-08-06,NEFT CR TRICHY SPARE POINT,N2026080601,,58500.00
2026-08-05,BHARAT PETRO FUEL OMR,POS9912,3200.00,
2026-08-04,SWIFT LOGISTICS FREIGHT AUG,N2026080402,18500.00,
2026-08-03,UPI CR HOSUR AUTO AGENCIES,UPI7781234,,96000.00
2026-08-02,BANK CHARGES RTGS,CHG9931,354.00,
`;

export default function BankImportsPage() {
  const s = useAppStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(s.bankAccounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const batches = Array.from(new Set(s.bankTxns.map((t) => t.importBatch))).map((batch) => {
    const lines = s.bankTxns.filter((t) => t.importBatch === batch);
    return {
      batch,
      count: lines.length,
      matched: lines.filter((l) => l.status === 'matched').length,
      account: s.bankAccounts.find((b) => b.id === lines[0]?.bankAccountId)?.name ?? '—',
      from: lines.reduce((min, l) => (l.date < min ? l.date : min), lines[0]?.date ?? ''),
      to: lines.reduce((max, l) => (l.date > max ? l.date : max), lines[0]?.date ?? ''),
    };
  });

  const onFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data
          .map((r) => {
            const debit = parseFloat((r.Debit ?? r.debit ?? '0').replace(/,/g, '') || '0');
            const credit = parseFloat((r.Credit ?? r.credit ?? '0').replace(/,/g, '') || '0');
            const amount = credit > 0 ? credit : debit;
            if (!amount) return null;
            return {
              date: (r.Date ?? r.date ?? '').slice(0, 10),
              amountPaise: Math.round(amount * 100),
              direction: (credit > 0 ? 'in' : 'out') as 'in' | 'out',
              narration: r.Narration ?? r.narration ?? r.Description ?? 'Imported line',
              reference: r.Reference ?? r.reference ?? '',
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (rows.length === 0) {
          toast.error('No usable rows found', {
            description: 'Expected columns: Date, Narration, Reference, Debit, Credit.',
          });
          return;
        }
        const result = importBankTxns(accountId, rows, file.name);
        toast.success(`${result.imported} transactions imported`, {
          description:
            result.duplicates > 0
              ? `${result.duplicates} duplicate line(s) were skipped automatically.`
              : 'No duplicates found.',
        });
      },
      error: () => toast.error('Could not read that file'),
    });
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample-bank-statement.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const pullFeed = async () => {
    setBusy(true);
    const n = await fetchBankFeed(accountId);
    setBusy(false);
    toast.success(`${n} transactions pulled from the bank feed`);
  };

  return (
    <>
      <PageHeader
        title="Imports & feeds"
        description="Bring bank transactions in by file upload or a live feed. Duplicate lines are detected and skipped."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-semibold">Upload a statement</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              CSV with columns: Date, Narration, Reference, Debit, Credit
            </p>
          </div>

          <Field label="Import into account">
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {s.bankAccounts.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) onFile(f);
            }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            <Upload className="mb-2 size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Drop a CSV here or click to browse</p>
            <p className="mt-1 text-xs text-muted-foreground">Most Indian banks export this format directly</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />

          <Button variant="outline" size="sm" onClick={downloadSample} className="gap-1.5">
            <Download className="size-3.5" /> Download a sample file
          </Button>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-semibold">Live bank feed</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Transactions arrive automatically each day — no uploading, no typing.
            </p>
          </div>

          <div className="space-y-2">
            {s.bankAccounts.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.feedConnected ? 'Connected · syncing daily' : 'Not connected'}
                  </p>
                </div>
                {b.feedConnected ? (
                  <Badge variant="outline" className="border-emerald-500/40 text-[10px]">Live</Badge>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => toast.info('Consent flow would open here', { description: 'In production this opens the bank’s consent screen.' })}>
                    Connect
                  </Button>
                )}
              </div>
            ))}
          </div>

          <Button onClick={pullFeed} disabled={busy} size="sm" className="gap-1.5">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {busy ? 'Fetching…' : 'Fetch now'}
          </Button>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold">Import history</h3>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No imports yet.</p>
        ) : (
          <div className="divide-y">
            {batches.map((b) => (
              <div key={b.batch} className="flex flex-wrap items-center gap-3 py-3">
                <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.batch}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.account} · {new Date(b.from).toLocaleDateString('en-IN')} – {new Date(b.to).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <Badge variant="secondary" className="text-[10px]">{b.count} lines</Badge>
                <Badge variant="outline" className="text-[10px]">{b.matched} matched</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
