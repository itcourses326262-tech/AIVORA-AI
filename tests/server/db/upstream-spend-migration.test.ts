import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '@/server/db';
import { runMigrations } from '@/server/db/migrate';

/*
 * The upgrade path of the daily upstream budget: a database that already holds generations (made
 * before the `upstream_spend` ledger existed) must keep counting the paid ones of the last 24 hours
 * the moment the migration runs, or the first day after deploying would be unprotected. The test
 * builds the database as it was one migration earlier, fills it with generations in every state,
 * and then applies the real migration folder on top.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const DRIZZLE = join(ROOT, 'drizzle');
const HOUR = 60 * 60 * 1000;

interface Journal {
  version: string;
  dialect: string;
  entries: Array<{ idx: number; tag: string }>;
}

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop() as string, { recursive: true, force: true });
});

/** A copy of the migrations folder that stops right before the one that creates `upstream_spend`. */
function folderBeforeLedger(): string {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, 'meta/_journal.json'), 'utf8')) as Journal;
  const ledger = journal.entries.find((entry) =>
    readFileSync(join(DRIZZLE, `${entry.tag}.sql`), 'utf8').includes(
      'CREATE TABLE `upstream_spend`',
    ),
  );
  if (!ledger) throw new Error('no migration creates upstream_spend');
  const folder = mkdtempSync(join(tmpdir(), 'aivore-ledger-migration-'));
  scratch.push(folder);
  mkdirSync(join(folder, 'meta'));
  const before = journal.entries.filter((entry) => entry.idx < ledger.idx);
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: before }),
  );
  for (const entry of before)
    cpSync(join(DRIZZLE, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  expect(readdirSync(folder).filter((name) => name.endsWith('.sql'))).toHaveLength(before.length);
  return folder;
}

describe('the upstream_spend migration', () => {
  it('books the paid generations of the last 24 hours that are still owed, and nothing else', () => {
    const db = createDb(':memory:');
    runMigrations(db, { migrationsFolder: folderBeforeLedger() });
    expect(
      db.$client.prepare("select name from sqlite_master where name = 'upstream_spend'").get(),
    ).toBeUndefined();

    // The rows go in with plain SQL and without foreign keys: only what the migration reads matters.
    db.$client.pragma('foreign_keys = OFF');
    const now = Date.now();
    const insert = db.$client.prepare(
      `insert into generations (id, user_id, tool, kind, model_id, provider, status, prompt, params, cost, created_at, updated_at)
       values (@id, 'usr_gone', 'text-to-image', 'image', 'm', @provider, @status, 'p', '{}', @cost, @createdAt, @createdAt)`,
    );
    const seed = (id: string, provider: string, status: string, cost: number, createdAt: number) =>
      insert.run({ id, provider, status, cost, createdAt });
    seed('gen_queued', 'fal', 'queued', 2, now - HOUR);
    seed('gen_processing', 'openai', 'processing', 3, now - 2 * HOUR);
    seed('gen_succeeded', 'fal', 'succeeded', 5, now - 23 * HOUR);
    seed('gen_failed', 'fal', 'failed', 7, now - HOUR); // refunded in full: not owed
    seed('gen_canceled', 'fal', 'canceled', 11, now - HOUR); // refunded in full: not owed
    seed('gen_demo', 'mock', 'succeeded', 13, now - HOUR); // the Demo provider costs nothing
    seed('gen_old', 'fal', 'succeeded', 17, now - 25 * HOUR); // has left the window

    const result = runMigrations(db);
    expect(result.applied).toBeGreaterThanOrEqual(1);

    const booked = db.$client
      .prepare(
        'select generation_id as id, provider, cost, released_at as releasedAt from upstream_spend order by id',
      )
      .all() as Array<{ id: string; provider: string; cost: number; releasedAt: number | null }>;
    expect(booked).toEqual([
      { id: 'gen_processing', provider: 'openai', cost: 3, releasedAt: null },
      { id: 'gen_queued', provider: 'fal', cost: 2, releasedAt: null },
      { id: 'gen_succeeded', provider: 'fal', cost: 5, releasedAt: null },
    ]);
    db.$client.close();
  });

  it('is harmless on an empty database', () => {
    const db = createDb(':memory:');
    runMigrations(db);
    expect(db.$client.prepare('select count(*) as n from upstream_spend').get()).toEqual({ n: 0 });
    db.$client.close();
  });
});
