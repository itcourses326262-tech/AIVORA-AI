import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@/lib/id';
import { createDb, type Db, type DbOrTx } from '@/server/db';
import { runMigrations } from '@/server/db/migrate';
import { users, type NewUserRow, type UserRow } from '@/server/db/schema';

export interface TestDb {
  db: Db;
  /** `:memory:` or the temp file backing the database. */
  path: string;
  /** Closes the connection and deletes the temp directory, if any. */
  close(): void;
}

/**
 * A fully migrated database. In-memory by default; `{ file: true }` backs it with a temp file so a
 * second connection (or process) can open the same data, which is what concurrency tests need.
 */
export function createTestDb(options: { file?: boolean } = {}): TestDb {
  const directory = options.file ? mkdtempSync(join(tmpdir(), 'aivore-test-db-')) : undefined;
  const path = directory ? join(directory, 'test.db') : ':memory:';
  const db = createDb(path);
  runMigrations(db);
  return {
    db,
    path,
    close() {
      if (db.$client.open) db.$client.close();
      if (directory) rmSync(directory, { recursive: true, force: true });
    },
  };
}

let userCounter = 0;

/** Inserts a user (50 credits by default) and returns the stored row. */
export function seedUser(db: DbOrTx, overrides: Partial<NewUserRow> = {}): UserRow {
  userCounter += 1;
  const now = Date.now();
  return db
    .insert(users)
    .values({
      id: newId('usr'),
      email: `user${userCounter}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      name: `Test User ${userCounter}`,
      passwordHash: 'not-a-real-hash',
      creditBalance: 50,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
}
