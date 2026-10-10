import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Every call is a fresh Node process with tsx: a few hundred milliseconds of start-up plus scrypt.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(import.meta.dirname, '../..');
const PASSWORD = 'correct horse battery staple';
let dir = '';
let databasePath = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'aivore-admin-script-'));
  databasePath = join(dir, 'admin.db');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `scripts/admin.ts` the way `npm run admin` does, with a controlled environment. */
function admin(args: string[], stdin?: string): Promise<Result> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--conditions=react-server', 'scripts/admin.ts', ...args],
      {
        cwd: ROOT,
        env: {
          NODE_ENV: 'development',
          PATH: process.env.PATH,
          SESSION_SECRET: 's'.repeat(40),
          DATABASE_PATH: databasePath,
          LOG_LEVEL: 'error',
        },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });
}

describe('scripts/admin.ts', () => {
  it('prints help with exit code 0', async () => {
    const result = await admin(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('create-user');
    expect(result.stdout).toContain('Exit codes');
  });

  it('creates an admin with a piped password and lists them, without ever printing the password', async () => {
    const created = await admin(
      ['create-user', '--email', 'Root@Example.com', '--role', 'admin', '--password-stdin'],
      `${PASSWORD}\n`,
    );
    expect(created.code).toBe(0);
    expect(created.stdout).toContain('Created admin root@example.com');
    expect(created.stdout + created.stderr).not.toContain(PASSWORD);

    const listed = await admin(['list-users', '--json']);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject([
      // The free sign-up credits are for Google sign-in: an operator-made account starts empty.
      { email: 'root@example.com', role: 'admin', credits: 0, status: 'active' },
    ]);

    const db = new Database(databasePath, { readonly: true });
    const row = db.prepare('select password_hash from users').get() as { password_hash: string };
    db.close();
    expect(row.password_hash).toMatch(/^scrypt\$32768\$8\$2\$/);
  });

  it('grants credits through the ledger', async () => {
    const granted = await admin(['grant-credits', '--email', 'root@example.com', '--amount', '25']);
    expect(granted.code).toBe(0);
    expect(granted.stdout).toContain('Balance: 25');
  });

  it('exits 1 when the command fails and 2 when it is used wrongly', async () => {
    const duplicate = await admin(
      ['create-user', '--email', 'root@example.com', '--password-stdin'],
      `${PASSWORD}\n`,
    );
    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toContain('Failed:');

    expect(
      (await admin(['grant-credits', '--email', 'ghost@example.com', '--amount', '5'])).code,
    ).toBe(1);
    expect((await admin(['grant-credits', '--email', 'root@example.com'])).code).toBe(2);
    const unknown = await admin(['nonsense']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown command');
    expect((await admin([])).code).toBe(2);
  });

  it('refuses to disable the only admin, and does it with --force', async () => {
    expect((await admin(['disable', '--email', 'root@example.com'])).code).toBe(1);
    expect((await admin(['disable', '--email', 'root@example.com', '--force'])).code).toBe(0);
    const listed = JSON.parse((await admin(['list-users', '--json'])).stdout) as Array<{
      status: string;
    }>;
    expect(listed[0]?.status).toBe('disabled');
  });
});
