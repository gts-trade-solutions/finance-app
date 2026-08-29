import { z } from 'zod';
import { transaction } from '@/lib/server/db';
import { route, body, asId } from '@/lib/server/http';
import { importStatement } from '@/lib/server/services/banking';
import { logAudit, auditMeta } from '@/lib/server/audit';

const RowInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.'),
  narration: z.string().min(1),
  reference: z.string().nullish(),
  depositPaise: z.number().int().nonnegative().optional(),
  withdrawalPaise: z.number().int().nonnegative().optional(),
  runningBalancePaise: z.number().int().nullish(),
});

const ImportInput = z.object({
  bankAccountId: z.string(),
  filename: z.string().min(1),
  rows: z.array(RowInput).min(1, 'The statement had no rows.').max(5000),
});

/**
 * Import parsed statement rows.
 *
 * The file is parsed in the browser — every bank exports a different CSV, and
 * the column mapping is something the user has to see and confirm. What arrives
 * here is already normalised rows, which keeps bank-specific quirks out of the
 * server entirely.
 */
export const POST = route(
  async ({ orgId, user, req }) => {
    const input = await body(req, ImportInput);

    const result = await transaction(async (trx) =>
      importStatement(
        trx, orgId, user.userId, Number(input.bankAccountId), input.filename, input.rows,
      ),
    );

    await logAudit({
      orgId, actorUserId: user.userId, actorName: user.name,
      action: 'import', targetType: 'bank_statement', targetId: result.importId,
      targetLabel: input.filename,
      detail: `${result.imported} imported, ${result.duplicates} already present, ${result.autoMatched} auto-matched`,
      ...auditMeta(req),
    });

    return { ...result, importId: asId(result.importId) };
  },
  { permission: { module: 'banking', action: 'create' } },
);
