import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb, createDb, getDb, isBusyError, withTx } from '@/server/db';
import { users } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';

const open: TestDb[] = [];
const scratch: string[] = [];

function testDb(options?: { file?: boolean }): TestDb {
  const created = createTestDb(options);
  open.push(created);
  return created;
}

afterEach(() => {
  while (open.length) open.pop()?.close();
  while (scratch.length) rmSync(scratch.pop() as string, { recursive: true, force: true });
  closeDb();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe('createDb', () => {
  it('turns on foreign keys and a 5 second busy timeout', () => {
    const { db } = testDb();
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('uses WAL for file databases', () => {
    const { db } = testDb({ file: true });
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.$client.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
  });

  it('creates missing parent directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'aivore-mkdir-'));
    scratch.push(root);
    const path = join(root, 'a', 'b', 'c', 'app.db');
    const db = createDb(path);
    expect(existsSync(path)).toBe(true);
    db.$client.close();
  });

  it('persists data across connections to the same file', () => {
    const { db, path } = testDb({ file: true });
    seedUser(db, { email: 'persist@example.com' });
    const second = createDb(path);
    expect(
      second
        .select()
        .from(users)
        .all()
        .map((row) => row.email),
    ).toEqual(['persist@example.com']);
    second.$client.close();
  });

  it('opens in-memory databases without touching the disk', () => {
    const db = createDb(':memory:');
    expect(db.$client.memory).toBe(true);
    db.$client.close();
  });
});

describe('getDb', () => {
  it('opens lazily at DATABASE_PATH with migrations applied, then reuses the connection', () => {
    const first = getDb();
    const tables = first.$client
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'users',
        'sessions',
        'api_keys',
        'credit_ledger',
        'generations',
        'assets',
      ]),
    );
    expect(getDb()).toBe(first);
  });

  it('survives module re-evaluation (Next.js dev HMR) without opening a second connection', async () => {
    const first = getDb();
    vi.resetModules();
    const reloaded = await import('@/server/db');
    expect(reloaded.getDb()).toBe(first);
  });

  it('opens a fresh connection after closeDb', () => {
    const first = getDb();
    closeDb();
    expect(first.$client.open).toBe(false);
    expect(getDb()).not.toBe(first);
  });

  it('follows DATABASE_PATH and closes the previous connection when it changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'aivore-getdb-'));
    scratch.push(root);
    const first = getDb();
    vi.stubEnv('DATABASE_PATH', join(root, 'nested', 'other.db'));
    resetEnvForTests();
    const second = getDb();
    expect(second).not.toBe(first);
    expect(first.$client.open).toBe(false);
    expect(second.$client.name).toBe(join(root, 'nested', 'other.db'));
  });

  it('closes the connection and rethrows when migrations fail', () => {
    const root = mkdtempSync(join(tmpdir(), 'aivore-getdb-bad-'));
    scratch.push(root);
    vi.stubEnv('DATABASE_PATH', join(root, 'bad.db'));
    resetEnvForTests();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root); // no drizzle/ folder here
    try {
      expect(() => getDb()).toThrow(/_journal\.json/);
    } finally {
      cwd.mockRestore();
    }
    // The failed attempt must not be cached as a usable database.
    vi.stubEnv('DATABASE_PATH', ':memory:');
    resetEnvForTests();
    expect(getDb().select().from(users).all()).toEqual([]);
  });
});

describe('withTx', () => {
  it('commits and returns the callback result', () => {
    const { db } = testDb();
    const id = withTx(db, (tx) => seedUser(tx, { email: 'a@example.com' }).id);
    expect(
      db
        .select()
        .from(users)
        .all()
        .map((row) => row.id),
    ).toEqual([id]);
  });

  it('rolls back everything when the callback throws', () => {
    const { db } = testDb();
    expect(() =>
      withTx(db, (tx) => {
        seedUser(tx, { email: 'gone@example.com' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.select().from(users).all()).toEqual([]);
  });

  it('rejects async callbacks and rolls back', () => {
    const { db } = testDb();
    expect(() =>
      withTx(db, (tx) => {
        seedUser(tx, { email: 'async@example.com' });
        return Promise.resolve(1) as unknown as number;
      }),
    ).toThrow(/synchronous/);
    expect(db.select().from(users).all()).toEqual([]);
  });

  it('takes the write lock up front (BEGIN IMMEDIATE), before any write happens', () => {
    const { db, path } = testDb({ file: true });
    const rival = new Database(path, { timeout: 0 });
    try {
      withTx(db, () => {
        // Nothing has been written yet, but a second writer must already be locked out.
        let code: unknown;
        try {
          rival.exec('BEGIN IMMEDIATE');
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code).toBe('SQLITE_BUSY');
      });
      rival.exec('BEGIN IMMEDIATE'); // free again once the transaction ended
      rival.exec('ROLLBACK');
    } finally {
      rival.close();
    }
  });

  it('joins an outer transaction through a savepoint: an inner failure rolls back only the inner work', () => {
    const { db } = testDb();
    withTx(db, (outer) => {
      seedUser(outer, { email: 'outer@example.com' });
      expect(() =>
        withTx(outer, (inner) => {
          seedUser(inner, { email: 'inner@example.com' });
          throw new Error('inner failed');
        }),
      ).toThrow('inner failed');
    });
    expect(
      db
        .select()
        .from(users)
        .all()
        .map((row) => row.email),
    ).toEqual(['outer@example.com']);
  });

  it('rolls back inner work together with the outer transaction', () => {
    const { db } = testDb();
    expect(() =>
      withTx(db, (outer) => {
        withTx(outer, (inner) => seedUser(inner, { email: 'inner@example.com' }));
        throw new Error('outer failed');
      }),
    ).toThrow('outer failed');
    expect(db.select().from(users).all()).toEqual([]);
  });
});

describe('isBusyError', () => {
  it('recognizes SQLite lock contention codes only', () => {
    expect(isBusyError({ code: 'SQLITE_BUSY' })).toBe(true);
    expect(isBusyError({ code: 'SQLITE_BUSY_SNAPSHOT' })).toBe(true);
    expect(isBusyError({ code: 'SQLITE_LOCKED' })).toBe(true);
    expect(isBusyError({ code: 'SQLITE_CONSTRAINT_CHECK' })).toBe(false);
    expect(isBusyError(new Error('busy'))).toBe(false);
    expect(isBusyError(null)).toBe(false);
  });
});
