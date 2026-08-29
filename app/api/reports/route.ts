import { z } from 'zod';
import { db } from '@/lib/server/db';
import { route, query, badRequest } from '@/lib/server/http';
import {
  trialBalance, profitAndLoss, balanceSheet, generalLedger, ageing,
} from '@/lib/server/reports/statements';

const ReportQuery = z.object({
  report: z.enum([
    'trial-balance', 'profit-and-loss', 'balance-sheet',
    'general-ledger', 'ar-ageing', 'ap-ageing',
  ]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give an end date as yyyy-mm-dd.'),
  branchId: z.string().optional(),
  accountId: z.string().optional(),
});

/**
 * Every statement, from one endpoint.
 *
 * They share a period, a branch filter and a shape, and the only thing that
 * differs is which aggregate runs. Six near-identical route files would have
 * six near-identical copies of the parsing and the permission check.
 *
 * Nothing is cached. Each figure is computed from the journal on the request,
 * which is what makes it impossible for two reports to disagree.
 */
export const GET = route(
  async ({ orgId, req }) => {
    const q = query(req, ReportQuery);
    const branchId = q.branchId ? Number(q.branchId) : undefined;

    switch (q.report) {
      case 'trial-balance': {
        const tb = await trialBalance(db, orgId, q.to, branchId);
        return { report: q.report, asOf: q.to, ...tb };
      }

      case 'balance-sheet': {
        const bs = await balanceSheet(db, orgId, q.to, branchId);
        return { report: q.report, ...bs };
      }

      case 'profit-and-loss': {
        if (!q.from) throw badRequest('A profit and loss needs a start date — it covers a period.');
        const pl = await profitAndLoss(db, orgId, q.from, q.to, branchId);
        return { report: q.report, ...pl };
      }

      case 'general-ledger': {
        if (!q.accountId) throw badRequest('Choose an account to see its ledger.');
        if (!q.from) throw badRequest('A ledger needs a start date.');
        const account = await db
          .selectFrom('accounts').select(['id', 'code', 'name', 'type'])
          .where('id', '=', Number(q.accountId)).where('org_id', '=', orgId).executeTakeFirst();
        if (!account) throw badRequest('That account does not exist.');

        const gl = await generalLedger(db, orgId, Number(q.accountId), q.from, q.to);
        return {
          report: q.report,
          account: { id: String(account.id), code: account.code, name: account.name, type: account.type },
          from: q.from,
          to: q.to,
          ...gl,
        };
      }

      case 'ar-ageing':
      case 'ap-ageing': {
        const side = q.report === 'ar-ageing' ? 'receivable' : 'payable';
        const result = await ageing(db, orgId, side, q.to);
        return { report: q.report, asOf: q.to, side, ...result };
      }
    }
  },
  { permission: { module: 'reports', action: 'view' } },
);
