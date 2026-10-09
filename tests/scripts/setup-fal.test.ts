import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
// Assembled at runtime: key-shaped literals are rejected by tests/security.
const KEY = ['fal', 'sk', 'abcd1234efgh5678'].join('_') + ':' + 'secret9876zyxw5432';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aivore-setup-fal-'));
  file = join(dir, 'env.local');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the real script with the given text on stdin (a pipe, not a terminal). */
function setup(stdin: string, extra: string[] = []): Promise<{ code: number; out: string }> {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--conditions=react-server',
        'scripts/setup-fal.ts',
        '--file',
        file,
        '--no-test',
        ...extra,
      ],
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    child.on('error', fail);
    child.on('close', (code) => done({ code: code ?? -1, out }));
    child.stdin.end(stdin);
  });
}

describe('npm run setup:fal', () => {
  it('saves the key, keeps other settings, adds a budget and never prints the key', async () => {
    writeFileSync(file, 'APP_URL=http://localhost:3000\n');
    const { code, out } = await setup(`${KEY}\n`);
    expect(code).toBe(0);
    expect(out).not.toContain(KEY);
    const saved = readFileSync(file, 'utf8');
    expect(saved).toContain('APP_URL=http://localhost:3000');
    expect(saved).toContain(`FAL_KEY=${KEY}`);
    expect(saved).toMatch(/^DAILY_UPSTREAM_BUDGET_CREDITS=200$/m);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  }, 60_000);

  it('ignores stray empty lines (a leftover Enter from pasting) and waits for the real key', async () => {
    const { code } = await setup(`\n\n${KEY}\n`);
    expect(code).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain(`FAL_KEY=${KEY}`);
  }, 60_000);

  it('keeps an existing budget instead of overwriting it', async () => {
    writeFileSync(file, 'DAILY_UPSTREAM_BUDGET_CREDITS=5000\nFAL_KEY=old\n');
    const { code } = await setup(`${KEY}\n`);
    expect(code).toBe(0);
    const saved = readFileSync(file, 'utf8');
    expect(saved).toContain('DAILY_UPSTREAM_BUDGET_CREDITS=5000');
    expect(saved).toContain(`FAL_KEY=${KEY}`);
    expect(saved).not.toContain('FAL_KEY=old');
  }, 60_000);

  it('saves nothing and explains when no key ever arrives', async () => {
    const { code, out } = await setup('');
    expect(code).toBe(1);
    expect(out).toMatch(/no key arrived/);
    expect(() => readFileSync(file, 'utf8')).toThrow();
  }, 60_000);

  it('refuses a key that is not one piece of text, and saves nothing', async () => {
    const { code, out } = await setup('this is not a key at all\n');
    expect(code).toBe(1);
    expect(out).toMatch(/spaces/);
    expect(() => readFileSync(file, 'utf8')).toThrow();
  }, 60_000);
});
