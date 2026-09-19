'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Connecting a PC that runs TallyPrime.
//
// The code is made when the dialog opens, shown once, and works once for
// fifteen minutes. It is the only thing typed into the connector — nobody's
// portal password goes near the PC. While the dialog stays open the page keeps
// looking for the connector, so the moment it pairs, this says so.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { tally } from '@/lib/api/tally';

const clock = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

export function PairingDialog({
  open,
  onOpenChange,
  pairedMachine,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set by the page once a connector pairs while this is open. */
  pairedMachine: string | null;
}) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await tally.createPairingCode());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) void make();
    else setCode(null);
  }, [open]);

  const expired = code ? new Date(code.expiresAt).getTime() <= Date.now() : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-slot="tally-pairing">
        <DialogHeader>
          <DialogTitle>Connect a PC running TallyPrime</DialogTitle>
          <DialogDescription>
            The connector reads your Tally companies and sends them here. It only reads — nothing in Tally is changed.
          </DialogDescription>
        </DialogHeader>

        {pairedMachine ? (
          <div className="flex items-start gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4" data-slot="tally-paired">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="text-sm">
              <p className="font-medium">Connected to {pairedMachine}</p>
              <p className="mt-0.5 text-muted-foreground">
                Your companies appear on this page as soon as their first sync finishes.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 px-4 py-5 text-center">
              <p className="micro-label">Pairing code</p>
              {busy ? (
                <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Making a code…
                </p>
              ) : code ? (
                <>
                  <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.18em]" data-slot="tally-code">
                    {code.code}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {expired ? 'This code has expired.' : `Works once, until ${clock(code.expiresAt)}.`}
                  </p>
                  <div className="mt-3 flex justify-center gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(code.code).then(() => toast.success('Code copied'));
                      }}
                    >
                      <Copy className="size-3" /> Copy
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => void make()}>
                      <RefreshCw className="size-3" /> New code
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-destructive">{error}</p>
              )}
            </div>

            <ol className="space-y-2 text-sm">
              <li className="flex gap-2.5">
                <span className="font-mono text-xs text-muted-foreground">1</span>
                <span>
                  In TallyPrime, press <kbd className="rounded border bg-muted px-1 text-xs">F1</kbd> Help → Settings →
                  Connectivity, and set TallyPrime to act as a server on port 9000.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-xs text-muted-foreground">2</span>
                <span>Open the REKONZA Tally connector on the same PC and enter this code.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-xs text-muted-foreground">3</span>
                <span>Keep TallyPrime open. The connector sends changes while it runs.</span>
              </li>
            </ol>
            {!pairedMachine && code && !expired && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Waiting for the connector…
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant={pairedMachine ? 'default' : 'outline'} onClick={() => onOpenChange(false)}>
            {pairedMachine ? 'Done' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
