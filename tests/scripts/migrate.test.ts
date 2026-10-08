import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length) rmSync(scratch.pop() as string, { recursive: true, force: true });
});

/** Runs `scripts/migrate.ts` exactly like `npm run db:migrate` does, with a controlled environment. */
async function migrate(env: Record<string, string>) {
  const childEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    PATH: process.env.PATH,
    SESSION_SECRET: 's'.repeat(40),
    ...env,
  };
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['--import', 'tsx', '--conditions=react-server', 'scripts/migrate.ts'],
      { cwd: ROOT, env: childEnv, timeout: 60_000 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

const lastJsonLine = (text: string) =>
  JSON.parse(
    text
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .at(-1) ?? 'null',
  ) as Record<string, unknown>;

describe('scripts/migrate.ts', () => {
  it('creates the database file, its folders and the schema, then reports what it did', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aivore-migrate-script-'));
    scratch.push(dir);
    const databasePath = join(dir, 'nested', 'app.db');

    const first = await migrate({ DATABASE_PATH: databasePath });
    expect(first.code).toBe(0);
    expect(lastJsonLine(first.stdout)).toMatchObject({
      msg: 'Database migrations complete',
      applied: 1,
      total: 1,
      level: 'info',
    });

    const db = new Database(databasePath, { readonly: true });
    const tables = (
      db.prepare("select name from sqlite_master where type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    db.close();
    expect(tables).toEqual(
      expect.arrayContaining(['users', 'credit_ledger', 'generations', 'assets']),
    );

    const second = await migrate({ DATABASE_PATH: databasePath });
    expect(second.code).toBe(0);
    expect(lastJsonLine(second.stdout)).toMatchObject({ applied: 0, total: 1 });
  }, 60_000);

  it('exits non-zero with a readable message when the configuration is invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aivore-migrate-script-'));
    scratch.push(dir);
    const result = await migrate({
      DATABASE_PATH: join(dir, 'app.db'),
      WORKER_CONCURRENCY: 'lots',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('WORKER_CONCURRENCY: must be a whole number between 1 and 32');
    expect(lastJsonLine(result.stderr)).toMatchObject({
      level: 'error',
      msg: 'Database migration failed',
    });
  }, 60_000);
});
