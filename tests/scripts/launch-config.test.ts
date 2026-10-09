import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BILLING_EMAIL_KINDS } from '@/server/email/types';

/**
 * Launch files that no other test reads: the CI workflow, the Dockerfile, .gitignore and the
 * owner's documents. Each test below pins a defect found in review, so that the same mistake
 * (a CI filter for a branch that does not exist, a `docker run` that loses the database, a document
 * that contradicts the code) fails here instead of on launch day.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

/** The indented lines under a top-level YAML key (`on:`, `jobs:` ...), comments included. */
function topLevelBlock(text: string, key: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) throw new Error(`No top-level key "${key}"`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    body.push(line);
  }
  return body.join('\n');
}

describe('CI workflow', () => {
  const ci = read('.github/workflows/ci.yml');

  it('starts on a push to any branch, not only on a branch that may not exist', () => {
    // The repository was created on a feature branch and has no `main`: `branches: [main]` meant
    // that pushing started no run at all, so the Docker job never ran.
    const triggers = topLevelBlock(ci, 'on');
    expect(triggers).toMatch(/^ {2}push:\n {4}branches: \['\*\*'\]$/m);
    expect(triggers).not.toMatch(/branches:\s*\[\s*main\s*\]/);
    expect(triggers).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it('gives the unit tests a timeout longer than the 5 s default', () => {
    // The moderation rule-data test takes about 3 s when the machine is idle and failed at 5 s on a
    // loaded one. 15 s is the least that leaves room; the job's own timeout bounds a real hang.
    const flag = /^\s*- run: npm test -- --testTimeout=(\d+)$/m.exec(ci);
    expect(flag).not.toBeNull();
    expect(Number(flag?.[1])).toBeGreaterThanOrEqual(15_000);
  });
});

describe('Dockerfile', () => {
  const dockerfile = read('Dockerfile');

  function image(name: string): string | undefined {
    return new RegExp(`^\\s+${name}=(\\S+?)(?: \\\\)?$`, 'm').exec(dockerfile)?.[1];
  }

  it('keeps idle connections open longer than the proxy in front keeps its own', () => {
    // Node closes an idle socket after 5 s; Caddy reuses an upstream connection for 2 minutes. The
    // difference is a 502 on whichever request meets the closing socket.
    const milliseconds = Number(image('KEEP_ALIVE_TIMEOUT'));
    expect(milliseconds).toBeGreaterThan(120_000);
  });

  it('relies on a variable that the Next.js server still reads', () => {
    // Should an upgrade rename it, the setting above would silently stop doing anything.
    expect(read('node_modules/next/dist/build/utils.js')).toContain(
      'process.env.KEEP_ALIVE_TIMEOUT',
    );
  });

  it('shows a docker run that keeps the database on the volume', () => {
    // `--env-file .env` beats the image's ENV, and a copy of .env.example says ./data/aivore.db.
    const header = dockerfile
      .split('\n')
      .filter((line) => line.startsWith('#'))
      .map((line) => line.replace(/^#\s?/, ''))
      .join('\n')
      .replace(/\\\n\s*/g, '');
    const run = /^\s*docker run .*$/m.exec(header)?.[0] ?? '';
    expect(run).toContain('--env-file');
    const afterEnvFile = run.slice(run.indexOf('--env-file'));
    expect(afterEnvFile).toContain(`-e DATABASE_PATH=${image('DATABASE_PATH')}`);
    expect(afterEnvFile).toContain(`-e STORAGE_LOCAL_DIR=${image('STORAGE_LOCAL_DIR')}`);
    expect(image('DATABASE_PATH')).toBe('/data/aivore.db');
    expect(image('STORAGE_LOCAL_DIR')).toBe('/data/media');
    // The tag the build command, compose and the docs use.
    expect(run).toMatch(/ aivore:local\s*$/);
  });
});

describe('.gitignore', () => {
  const rules = read('.gitignore');
  const inWorkTree =
    spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).stdout?.trim() === 'true';

  it('lists the backup folders and the local compose override', () => {
    expect(rules).toMatch(/^\/backups$/m);
    expect(rules).toMatch(/^docker-compose\.override\.yml$/m);
  });

  /** 0 = ignored, 1 = not ignored; `--no-index` so that a tracked file is judged by the rules alone. */
  function ignored(path: string): boolean {
    const result = spawnSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT });
    if (result.status !== 0 && result.status !== 1)
      throw new Error(`git check-ignore: ${result.status}`);
    return result.status === 0;
  }

  it.skipIf(!inWorkTree)('keeps real backups out of git and tracked files in', async () => {
    const { backupName } = (await import(
      /* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts/backup.mjs')).href
    )) as { backupName(date: Date): string };
    const name = backupName(new Date(Date.UTC(2026, 9, 9, 3, 45, 0)));
    for (const path of [
      `backups/${name}/aivore.db`,
      `backups/${name}/media.tar`,
      `${name}/manifest.json`,
      `${name}.partial/media.tar`,
      'docker-compose.override.yml',
      'data/backups/anything',
    ]) {
      expect(ignored(path), path).toBe(true);
    }
    for (const path of [
      'docker-compose.yml',
      'docker-compose.override.example.yml',
      'scripts/backup.mjs',
      'scripts/restore.mjs',
      '.env.example',
    ]) {
      expect(ignored(path), path).toBe(false);
    }
  });
});

describe('DEPLOYMENT.md', () => {
  it('builds the image copied to a server for the server CPU', () => {
    // A plain `docker build` on an Apple Silicon laptop makes an arm64 image: `exec format error`
    // on the usual x86_64 VPS.
    const fences = read('docs/DEPLOYMENT.md').split('```');
    const block = fences.find((text) => text.includes('docker save'));
    expect(block).toBeDefined();
    expect(block).toMatch(/^\s*docker build --platform linux\/(amd64|arm64) -t aivore:local \.$/m);
  });
});

describe('documents agree with the billing e-mail the code sends', () => {
  const documents = {
    'README.md': read('README.md'),
    'docs/LAUNCH.md': read('docs/LAUNCH.md'),
    'docs/OPERATIONS.md': read('docs/OPERATIONS.md'),
    'docs/DEPLOYMENT.md': read('docs/DEPLOYMENT.md'),
  };

  // Sentences from the time before `server/billing/mail.ts`, when nothing about money was mailed.
  const STALE: RegExp[] = [
    /not e-?mailed/i,
    /no billing e-?mails/i,
    /no renewal e-?mail/i,
    /renewal e-?mail with a reminder/i,
    /e-?mail module has no billing message/i,
    /لا يُرسَل الرابط بالبريد/,
    /ولا بالبريد/,
    /ولا يُرسَل بالبريد/,
    /لا توجد رسائل فوترة/,
    /لا توجد رسالة فوترة/,
    /عدم وجود رسالة تجديد/,
  ];

  it.each(Object.entries(documents))('%s makes none of the old claims', (_file, text) => {
    for (const stale of STALE) expect(text, String(stale)).not.toMatch(stale);
  });

  it('ARCHITECTURE.md keeps the old claim only struck through', () => {
    expect(read('docs/ARCHITECTURE.md')).not.toMatch(
      /(?<!~~)Renewal payment links are NOT e-mailed/,
    );
  });

  it('LAUNCH.md names every billing message in both languages, so that a new one is noticed', () => {
    // Each kind is a value of the `kind` field of the "Email could not be delivered" alert.
    const launch = documents['docs/LAUNCH.md'];
    for (const kind of BILLING_EMAIL_KINDS) {
      const mentions = launch.split(`\`${kind}\``).length - 1;
      expect(mentions, kind).toBeGreaterThanOrEqual(2);
    }
  });

  it('explains that billing e-mail depends on SMTP and is sent at most once', () => {
    expect(documents['README.md']).toContain('email_events');
    expect(documents['docs/LAUNCH.md']).toContain('outbox.jsonl');
    expect(documents['docs/OPERATIONS.md']).toContain('sent_at');
    expect(documents['docs/OPERATIONS.md']).toContain('at most once');
  });
});

describe('Arabic wording', () => {
  const readme = read('README.md');
  const launch = read('docs/LAUNCH.md');

  it('uses the legal pages’ term for cookies, with the colloquial one only in brackets', () => {
    for (const text of [readme, launch]) {
      expect(text).not.toContain('كعك');
      for (const match of text.matchAll(/كوكيز/g)) {
        const before = text.slice(Math.max(0, match.index - 32), match.index);
        expect(before, 'the colloquial word stands in brackets after the official term').toMatch(
          /ملف(?:ات)? تعريف الارتباط \(ال$/,
        );
      }
    }
  });

  it('calls the job runner section by the name used everywhere else', () => {
    // "العمال" reads as human workers.
    expect(readme).not.toContain('العمال');
    expect(readme).toContain('### المنفّذ والحدود');
  });
});
