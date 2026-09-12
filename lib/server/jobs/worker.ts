import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// The worker that runs queued retries, inside the server process.
//
// The same shape as the email app's: started once per process, ticking on a
// timer, claiming one due job at a time. A retry is due minutes after it was
// queued, so a tick every fifteen seconds runs it close enough to its time.
//
// JOBS_WORKER=off keeps it from starting, for a process that should only serve
// pages while another one runs the queue.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { db, transaction } from '../db';
import { claimDueJob, recoverStaleJobs, settleJob } from './queue';
import { runJobHandler } from './handlers';

const TICK_MS = Number(process.env.JOBS_TICK_MS) || 15_000;
/** Names this process on the rows it claims, so a stuck row says whose it was. */
export const WORKER_ID = `${process.pid}:${randomUUID().slice(0, 8)}`;

/** Run what is due now, up to `limit` jobs. Returns how many ran. */
export async function runDueJobs(limit = 10): Promise<number> {
  await recoverStaleJobs(db);
  let ran = 0;
  while (ran < limit) {
    const job = await transaction((trx) => claimDueJob(trx, WORKER_ID, new Date()));
    if (!job) break;
    const outcome = await runJobHandler(job);
    const status = await settleJob(db, job, outcome);
    if (status !== 'completed') {
      console.warn(`[jobs] ${job.kind} #${job.id} ${status} after attempt ${job.attempts}:`, 'error' in outcome ? outcome.error : '');
    }
    ran++;
  }
  return ran;
}

export function startJobWorker(): void {
  const g = globalThis as typeof globalThis & { __rekonzaJobWorker?: boolean };
  if (g.__rekonzaJobWorker || process.env.JOBS_WORKER === 'off') return;
  g.__rekonzaJobWorker = true;

  const tick = async () => {
    try {
      await runDueJobs();
    } catch (err) {
      console.error('[jobs] tick failed', err);
    } finally {
      setTimeout(tick, TICK_MS).unref?.();
    }
  };
  setTimeout(tick, TICK_MS).unref?.();
}
