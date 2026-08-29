import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// The database connection.
//
// One mysql2 pool, wrapped in Kysely for typed queries. Kysely is a query
// builder, not an ORM: it compiles to the SQL you would have written, and there
// is no session, no lazy loading and no change tracking between the code and
// the ledger. For an accounting system that matters — an ORM deciding when to
// flush is an ORM deciding when a journal entry exists.
//
// The pool is cached on globalThis because Next.js re-evaluates modules on
// every hot reload in development, and a fresh 20-connection pool per reload
// exhausts MySQL's connection limit within a few minutes of editing.
// ─────────────────────────────────────────────────────────────────────────────

import { Kysely, MysqlDialect, sql, type Transaction } from 'kysely';
import mysql from 'mysql2';
import type { DB } from './db-types';

declare global {
  var __finoraPool: mysql.Pool | undefined;
  var __finoraDb: Kysely<DB> | undefined;
}

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'finora_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'finora',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 20,
    queueLimit: Number(process.env.DB_QUEUE_LIMIT) || 200,
    maxIdle: 10,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    connectTimeout: 10_000,
    // Never on for the application pool. Multi-statement queries turn a single
    // injected semicolon into a second statement; only the migration runner
    // enables it, and only against files on disk.
    multipleStatements: false,
    timezone: 'local',
    // DECIMAL always arrives as a string — that is the whole point of storing
    // money as DECIMAL, and money-sql.ts converts it to integer paise without
    // ever going through a float.
    decimalNumbers: false,
    // BIGINT arrives as a number, falling back to a string only when the value
    // would actually lose precision past 2^53. Forcing every BIGINT to a string
    // makes row ids strings too, which silently breaks any Map keyed on an id
    // and contradicts the generated types, where they are numbers.
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: ['DATE'],
  });
}

export const pool: mysql.Pool = globalThis.__finoraPool ?? createPool();
if (process.env.NODE_ENV !== 'production') globalThis.__finoraPool = pool;

export const db: Kysely<DB> =
  globalThis.__finoraDb ??
  new Kysely<DB>({
    dialect: new MysqlDialect({ pool }),
    log:
      process.env.DB_LOG === 'query'
        ? (event) => {
            if (event.level === 'query') {
              console.log(`[sql ${event.queryDurationMillis.toFixed(1)}ms]`, event.query.sql);
            }
          }
        : undefined,
  });
if (process.env.NODE_ENV !== 'production') globalThis.__finoraDb = db;

export { sql };
export type { DB } from './db-types';
export type Db = Kysely<DB>;

/**
 * A transaction handle. Every function that writes to the ledger takes one of
 * these rather than reaching for the module-level `db`, so a caller can compose
 * several writes into one atomic unit — allocating an invoice number and
 * posting its journal entry have to succeed or fail together.
 *
 * `Transaction<DB>` extends `Kysely<DB>`, so a read helper can be typed against
 * `Executor` and work equally well inside or outside a transaction.
 */
export type Trx = Transaction<DB>;
export type Executor = Kysely<DB> | Trx;

/** Run `fn` inside a transaction, rolling back on any thrown error. */
export function transaction<T>(fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}

/** Cheap liveness probe for the health endpoint and the smoke tests. */
export async function ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await sql`SELECT 1`.execute(db);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}
