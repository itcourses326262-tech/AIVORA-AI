import 'server-only';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SQLiteTransaction } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
/** The handle passed to a transaction callback. Same query API as {@link Db}. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Accepted by functions that join the caller's transaction when given a {@link Tx}. */
export type DbOrTx = Db | Tx;

function isThenable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Runs `fn` atomically. On a {@link Db} it opens `BEGIN IMMEDIATE`, taking the write lock up front
 * so read-then-write sequences cannot interleave with another connection (no `SQLITE_BUSY_SNAPSHOT`
 * upgrade failures). On a {@link Tx} it joins the caller's transaction through a savepoint, so an
 * error inside rolls back only this unit of work.
 *
 * better-sqlite3 is synchronous: `fn` must not be async. A returned promise rolls back and throws.
 */
export function withTx<T>(db: DbOrTx, fn: (tx: Tx) => T): T {
  const run = (tx: Tx): T => {
    const result = fn(tx);
    if (isThenable(result)) {
      throw new TypeError('withTx callbacks must be synchronous; do not return a Promise');
    }
    return result;
  };
  if (db instanceof SQLiteTransaction) return (db as Tx).transaction(run);
  return (db as Db).transaction(run, { behavior: 'immediate' });
}

/** True for SQLite lock contention errors (`SQLITE_BUSY`, `SQLITE_LOCKED` and their variants). */
export function isBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code } = error as { code?: unknown };
  return (
    typeof code === 'string' && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'))
  );
}
