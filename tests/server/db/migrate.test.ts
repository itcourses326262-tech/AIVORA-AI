import { execFile, execFileSync } from 'node:child_process';
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
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getTableName, is, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '@/server/db';
import { runMigrations } from '@/server/db/migrate';
import * as schema from '@/server/db/schema';
import { users } from '@/server/db/schema';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../..');
const open: TestDb[] = [];
const scratch: string[] = [];

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  while (open.length) open.pop()?.close();
  while (scratch.length) rmSync(scratch.pop() as string, { recursive: true, force: true });
});

const schemaTableNames = (): string[] =>
  Object.values(schema)
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .map((table) => getTableName(table));

const journalLength = (): number =>
  (
    JSON.parse(readFileSync(join(ROOT, 'drizzle/meta/_journal.json'), 'utf8')) as {
      entries: unknown[];
    }
  ).entries.length;

const tableNames = (db: TestDb['db']) =>
  (
    db.$client
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
      .all() as Array<{ name: string }>
  )
    .map((row) => row.name)
    .sort();

describe('runMigrations', () => {
  it('creates the whole schema on a fresh database', () => {
    const db = createDb(':memory:');
    const result = runMigrations(db);
    expect(result.applied).toBe(result.total);
    expect(result.total).toBeGreaterThanOrEqual(1);
    // Derived from schema.ts, so a module that adds a table does not have to edit this test.
    expect(tableNames(db)).toEqual(['__drizzle_migrations', ...schemaTableNames()].sort());
    db.$client.close();
  });

  it('is idempotent and keeps existing data', () => {
    const test = createTestDb();
    open.push(test);
    const user = seedUser(test.db, { email: 'keep@example.com' });
    const before = test.db.$client.prepare('select count(*) as n from __drizzle_migrations').get();
    expect(runMigrations(test.db).applied).toBe(0);
    expect(runMigrations(test.db).applied).toBe(0);
    expect(test.db.$client.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual(
      before,
    );
    expect(
      test.db
        .select()
        .from(users)
        .all()
        .map((row) => row.id),
    ).toEqual([user.id]);
  });

  it('records each migration with its hash and timestamp', () => {
    const test = createTestDb();
    open.push(test);
    const rows = test.db.$client
      .prepare('select hash, created_at from __drizzle_migrations')
      .all() as Array<{
      hash: string;
      created_at: number;
    }>;
    const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle/meta/_journal.json'), 'utf8')) as {
      entries: Array<{ when: number }>;
    };
    expect(rows).toHaveLength(journal.entries.length);
    expect(rows[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(rows[0]?.created_at)).toBe(journal.entries[0]?.when);
  });

  it('shares its bookkeeping with drizzle-orm, in both directions', () => {
    const mine = createDb(':memory:');
    runMigrations(mine);
    expect(() => drizzleMigrate(mine, { migrationsFolder: join(ROOT, 'drizzle') })).not.toThrow();
    expect(mine.$client.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({
      n: journalLength(),
    });
    mine.$client.close();

    const theirs = createDb(':memory:');
    drizzleMigrate(theirs, { migrationsFolder: join(ROOT, 'drizzle') });
    expect(runMigrations(theirs).applied).toBe(0);
    theirs.$client.close();
  });

  it('applies only the migrations that are new', () => {
    const folder = scratchDir('aivore-migrations-');
    mkdirSync(join(folder, 'meta'));
    const write = (entries: Array<{ tag: string; when: number; sql: string }>) => {
      writeFileSync(
        join(folder, 'meta/_journal.json'),
        JSON.stringify({
          version: '7',
          dialect: 'sqlite',
          entries: entries.map((entry, idx) => ({
            idx,
            version: '6',
            when: entry.when,
            tag: entry.tag,
            breakpoints: true,
          })),
        }),
      );
      for (const entry of entries) writeFileSync(join(folder, `${entry.tag}.sql`), entry.sql);
    };
    const first = { tag: '0000_a', when: 1_700_000_000_000, sql: 'CREATE TABLE a (id integer);' };
    const second = {
      tag: '0001_b',
      when: 1_700_000_001_000,
      sql: 'CREATE TABLE b (id integer);\n--> statement-breakpoint\nCREATE TABLE c (id integer);',
    };

    const db = createDb(':memory:');
    write([first]);
    expect(runMigrations(db, { migrationsFolder: folder })).toEqual({ applied: 1, total: 1 });
    write([first, second]);
    expect(runMigrations(db, { migrationsFolder: folder })).toEqual({ applied: 1, total: 2 });
    expect(tableNames(db)).toEqual(['__drizzle_migrations', 'a', 'b', 'c']);
    db.$client.close();
  });

  it('rolls back everything when one statement fails', () => {
    const folder = scratchDir('aivore-bad-migration-');
    mkdirSync(join(folder, 'meta'));
    writeFileSync(
      join(folder, 'meta/_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          { idx: 0, version: '6', when: 1_700_000_000_000, tag: '0000_bad', breakpoints: true },
        ],
      }),
    );
    writeFileSync(
      join(folder, '0000_bad.sql'),
      'CREATE TABLE ok_table (id integer);\n--> statement-breakpoint\nCREATE TABLE broken (;',
    );

    const db = createDb(':memory:');
    expect(() => runMigrations(db, { migrationsFolder: folder })).toThrow();
    // Not even the bookkeeping table survived: the whole run is one transaction.
    expect(tableNames(db)).toEqual([]);
    db.$client.close();
  });

  it('fails with a clear error when the migrations folder is missing', () => {
    const db = createDb(':memory:');
    expect(() =>
      runMigrations(db, { migrationsFolder: join(tmpdir(), 'aivore-does-not-exist') }),
    ).toThrow(/_journal\.json/);
    db.$client.close();
  });

  it('applies exactly once when several processes migrate a fresh database at the same time', async () => {
    const dir = scratchDir('aivore-migrate-race-');
    const path = join(dir, 'race.db');
    const startAt = Date.now() + 2500;
    const spawn = () =>
      run(
        process.execPath,
        [
          '--import',
          'tsx',
          '--conditions=react-server',
          'tests/helpers/migrate-worker.ts',
          path,
          String(startAt),
        ],
        { cwd: ROOT, timeout: 60_000 },
      );
    const outputs = await Promise.all([spawn(), spawn(), spawn()]);
    const results = outputs.map(
      ({ stdout }) =>
        JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as { applied: number; total: number },
    );
    const total = results[0]?.total ?? 0;
    expect(total).toBeGreaterThanOrEqual(1);
    expect(results.reduce((sum, result) => sum + result.applied, 0)).toBe(total);

    const db = createDb(path);
    expect(db.get(sql`select count(*) as n from __drizzle_migrations`)).toEqual({ n: total });
    db.$client.close();
  }, 60_000);
});

describe('committed migrations', () => {
  it('match src/server/db/schema.ts (run `npm run db:generate` after changing the schema)', () => {
    const out = scratchDir('aivore-drift-');
    cpSync(join(ROOT, 'drizzle'), out, { recursive: true });
    const before = readdirSync(out).sort();
    const output = execFileSync(
      process.execPath,
      [
        '--conditions=react-server',
        './node_modules/drizzle-kit/bin.cjs',
        'generate',
        '--dialect',
        'sqlite',
        '--schema',
        './src/server/db/schema.ts',
        '--out',
        relative(ROOT, out),
      ],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000 },
    );
    expect(output).toContain('No schema changes');
    expect(readdirSync(out).sort()).toEqual(before);
  }, 60_000);
});
