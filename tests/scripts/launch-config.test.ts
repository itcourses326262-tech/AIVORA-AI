import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

  describe('the command-line tools in the image', () => {
    // What /app/scripts holds: the TypeScript tools esbuild bundles, and the .mjs files that are copied.
    const code = dockerfile
      .replace(/\\\n/g, ' ')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    const bundled = [...code.matchAll(/\bscripts\/([a-z0-9-]+)\.ts\b/g)].map((m) => m[1] as string);
    const copied = [...code.matchAll(/\bscripts\/([a-z0-9-]+)\.mjs\b/g)].map((m) => m[1] as string);
    const inImage = new Set([...bundled, ...copied]);

    // Tools for a checkout, not for the container: `preview.mjs` mirrors the working tree.
    const CHECKOUT_ONLY = new Set(['preview']);

    const documents = ['README.md', ...readdirSync(join(ROOT, 'docs')).map((f) => `docs/${f}`)]
      .filter((file) => file.endsWith('.md'))
      .map((file) => ({ file, text: read(file) }));
    const named = documents.flatMap(({ file, text }) =>
      [...text.matchAll(/\bnode scripts\/([a-z0-9-]+)\.mjs\b/g)].map((m) => ({
        file,
        tool: m[1] as string,
      })),
    );

    it('has every source file it bundles', () => {
      expect(bundled.length).toBeGreaterThan(0);
      for (const name of bundled) {
        expect(() => read(`scripts/${name}.ts`), name).not.toThrow();
      }
      for (const name of copied) {
        expect(() => read(`scripts/${name}.mjs`), name).not.toThrow();
      }
    });

    it('holds every `node scripts/<name>.mjs` that README.md and docs/ tell an operator to run', () => {
      // `docker compose exec app node scripts/check-storage.mjs` was documented while the image only
      // had five tools: MODULE_NOT_FOUND, on the day the pictures had to be moved.
      expect(new Set(named.map(({ tool }) => tool))).toContain('check-storage');
      expect(new Set(named.map(({ tool }) => tool))).toContain('migrate-media');
      const missing = named
        .filter(({ tool }) => !CHECKOUT_ONLY.has(tool) && !inImage.has(tool))
        .map(({ file, tool }) => `${file}: node scripts/${tool}.mjs`);
      expect(missing).toEqual([]);
    });

    it('bundles the storage tools with the same flags as the other bundled tools', () => {
      const command = /esbuild [^\n]*(?:\n[^\n]*)*?--log-level=warning/.exec(code)?.[0] ?? '';
      expect(command).toContain('scripts/check-storage.ts');
      expect(command).toContain('scripts/migrate-media.ts');
      expect(command).toContain('--external:better-sqlite3');
      expect(command).toContain('--external:sharp');
      expect(command).toContain('--conditions=react-server');
    });

    it('names every one of its tools in the header comment', () => {
      // The comment block that opens the file, before the first instruction.
      const header = dockerfile
        .slice(0, dockerfile.indexOf('\nARG '))
        .split('\n')
        .filter((line) => line.startsWith('#'))
        .join(' ')
        .replace(/\s+/g, ' ');
      for (const name of inImage) expect(header, name).toMatch(new RegExp(`[ (]${name}[,:)]`));
    });
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

describe('service-account keys', () => {
  // `Generate new private key` downloads `<project>-firebase-adminsdk-<id>-<hash>.json` into the
  // folder the browser saves to, which is easily the checkout. setup:firebase searched there, left
  // the original behind, and nothing stopped `git add -A` or `COPY . .` from taking it.
  const NAMES = [
    'aivore-a71f1-firebase-adminsdk-fbsvc-0123456789.json',
    'firebase-adminsdk-fbsvc-0123456789.json',
    'firebase-service-account.json',
    'service-account.json',
    'my-service-account-key.json',
    'data/firebase-service-account.json',
    'keys/aivore-a71f1-firebase-adminsdk-fbsvc-0123456789.json',
  ];
  const ORDINARY = ['package.json', 'tsconfig.json', 'drizzle/meta/_journal.json', '.env.example'];

  const inWorkTree =
    spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).stdout?.trim() === 'true';

  it.skipIf(!inWorkTree)('are ignored by git wherever they are saved', () => {
    for (const name of NAMES) {
      const result = spawnSync('git', ['check-ignore', '-q', '--no-index', name], { cwd: ROOT });
      expect(result.status, name).toBe(0);
    }
    for (const name of ORDINARY) {
      const result = spawnSync('git', ['check-ignore', '-q', '--no-index', name], { cwd: ROOT });
      expect(result.status, name).toBe(1);
    }
  });

  /**
   * A .dockerignore pattern as Docker reads it: relative to the context root (so only `**` goes
   * deeper), `*` stays inside one path segment, and a match on a folder covers what is below it.
   */
  function dockerPattern(pattern: string): RegExp {
    const parts = pattern.split('/');
    const source = parts
      .map((part, index) => {
        const last = index === parts.length - 1;
        if (part === '**') return last ? '.*' : '(?:.*/)?';
        const body = part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
        return last ? body : `${body}/`;
      })
      .join('');
    return new RegExp(`^${source}(?:/.*)?$`);
  }

  function dockerIgnores(path: string): boolean {
    let ignored = false;
    for (const line of read('.dockerignore').split('\n')) {
      const rule = line.trim();
      if (rule === '' || rule.startsWith('#')) continue;
      const negated = rule.startsWith('!');
      if (dockerPattern(negated ? rule.slice(1) : rule).test(path)) ignored = !negated;
    }
    return ignored;
  }

  it('stay out of the Docker build context wherever they are saved', () => {
    for (const name of NAMES) expect(dockerIgnores(name), name).toBe(true);
    for (const name of ORDINARY) expect(dockerIgnores(name), name).toBe(false);
  });

  it('are not sitting anywhere git would add them', () => {
    // The root-level file the guard in tests/security cannot see (it scans src, tests, scripts, e2e
    // and docs for key-shaped TEXT). Whatever git would stage must not hold a service-account key,
    // whatever the file is called.
    if (!inWorkTree) return;
    const listed = spawnSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const hits = listed.stdout
      .split('\0')
      .filter((file) => file.endsWith('.json'))
      .filter((file) => {
        try {
          return /"type"\s*:\s*"service_account"/.test(read(file));
        } catch {
          return false; // listed but deleted in the working tree
        }
      });
    expect(hits, 'a service-account key is not ignored by git: move it into ./data').toEqual([]);
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

describe('the Firebase bucket documents', () => {
  const operations = read('docs/OPERATIONS.md');
  const deployment = read('docs/DEPLOYMENT.md');
  const flat = (text: string) => text.replace(/\s+/g, ' ');

  it('pair Object Versioning with a lifecycle rule and the privacy text', () => {
    // Versioning alone keeps a deleted user's pictures as noncurrent versions, forever.
    const text = flat(operations);
    expect(text).toMatch(/lifecycle rule that deletes noncurrent versions after N days/);
    expect(text).toContain('daysSinceNoncurrentTime');
    expect(text).toContain('write the same N in the privacy text');
    expect(text).toContain('legal-documents.ts');
    expect(text).toMatch(/soft delete.{0,120}default retention/i);
  });

  it('say that picture reads ignore HTTPS_PROXY unless NODE_USE_ENV_PROXY is set, and how it shows', () => {
    for (const [file, text] of [
      ['OPERATIONS.md', operations],
      ['DEPLOYMENT.md', deployment],
    ] as const) {
      const body = flat(text);
      expect(body, file).toContain('NODE_USE_ENV_PROXY=1');
      expect(body, file).toContain('HTTPS_PROXY');
      expect(body, file).toContain('read it back whole');
    }
  });

  it('say that the key file is checked at start-up, with the line the server really logs', () => {
    expect(deployment).not.toMatch(/not at start-up/);
    expect(flat(deployment)).toContain('A wrong key file stops the site at start-up');
    expect(flat(operations)).toContain('Storage is not usable (STORAGE_DRIVER=gcs)');
  });

  it('say that setup:firebase never switches STORAGE_DRIVER by itself', () => {
    expect(flat(operations)).toContain('never changes `STORAGE_DRIVER` by itself');
    expect(flat(deployment)).toContain('never changes `STORAGE_DRIVER` by itself');
  });

  it('say that the backup warns about files left in STORAGE_LOCAL_DIR', () => {
    expect(flat(operations)).toMatch(
      /`WARNING` line says how many files are still in `STORAGE_LOCAL_DIR`/,
    );
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
