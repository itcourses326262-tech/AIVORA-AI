import 'server-only';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { getEnv } from '@/server/env';
import { runMigrations } from './migrate';
import * as schema from './schema';
import type { Db } from './tx';

export { schema };

export { isBusyError, withTx, type Db, type DbOrTx, type Tx } from './tx';

const BUSY_TIMEOUT_MS = 5000;

/**
 * Opens a SQLite database with the project's pragmas: foreign keys on, `busy_timeout` 5 s so
 * concurrent writers wait instead of failing, and WAL for file databases (readers never block the
 * writer). Missing parent directories are created. Migrations are NOT applied here.
 */
export function createDb(path: string): Db {
  const inMemory = path === ':memory:' || path === '';
  if (!inMemory) mkdirSync(dirname(resolve(path)), { recursive: true });

  const sqlite = new Database(inMemory ? ':memory:' : path, { timeout: BUSY_TIMEOUT_MS });
  try {
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    sqlite.pragma('foreign_keys = ON');
    if (!inMemory) {
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('synchronous = NORMAL');
    }
    return drizzle(sqlite, { schema });
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

interface DbHolder {
  db: Db;
  path: string;
}

// Kept on globalThis so Next.js dev HMR (which re-evaluates modules) does not leak connections.
const HOLDER_KEY = Symbol.for('aivore.db');
type GlobalWithDb = typeof globalThis & { [HOLDER_KEY]?: DbHolder };

/**
 * The process-wide database, opened on first use at `DATABASE_PATH` with all migrations applied.
 * Never call it at module scope: `next build` imports every route.
 */
export function getDb(): Db {
  const scope = globalThis as GlobalWithDb;
  const path = getEnv().DATABASE_PATH;
  const existing = scope[HOLDER_KEY];
  if (existing && existing.path === path) return existing.db;
  existing?.db.$client.close();

  const db = createDb(path);
  try {
    runMigrations(db);
  } catch (error) {
    db.$client.close();
    throw error;
  }
  scope[HOLDER_KEY] = { db, path };
  return db;
}

/** Closes the shared connection; the next `getDb()` opens a fresh one. */
export function closeDb(): void {
  const scope = globalThis as GlobalWithDb;
  scope[HOLDER_KEY]?.db.$client.close();
  scope[HOLDER_KEY] = undefined;
}
