import { execFile, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '@/server/db';
import { runMigrations } from '@/server/db/migrate';
import { seedUser } from '../helpers/db';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');

interface BackupManifest {
  format: string;
  createdAt: string;
  database: {
    file: string;
    bytes: number;
    sha256: string;
    integrityCheck: string;
    migrations: { count: number; latest: number | null } | null;
    tables: Record<string, number>;
  };
  media: { file: string; bytes: number; sha256: string; files: number } | null;
}

interface Io {
  env?: Record<string, string | undefined>;
  cwd?: string;
  log?: (line: string) => void;
  error?: (line: string) => void;
  now?: Date;
}

interface BackupModule {
  runBackup(argv: string[], io?: Io): Promise<number>;
  createBackup(
    options: { database: string; media: string | null; out: string; keep?: number },
    hooks?: { now?: Date; log?: (line: string) => void },
  ): Promise<{ dir: string; manifest: BackupManifest; removed: string[] }>;
  backupName(date: Date): string;
  listBackups(dir: string): string[];
  pruneBackups(dir: string, keep: number, now?: number): { removed: string[] };
  isInside(outer: string, inner: string): boolean;
  formatBytes(bytes: number): string;
  sha256File(path: string): Promise<string>;
  checkIntegrity(path: string): { ok: boolean; messages: string[] };
}

// The script is plain ESM JavaScript (it runs in the Docker image without a build step), so it is
// loaded by URL: that keeps TypeScript from asking for declarations of a file it does not compile.
const backup = (await import(
  /* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts/backup.mjs')).href
)) as BackupModule;

const scratch: string[] = [];
const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) if (db.open) db.close();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aivore-backup-test-'));
  scratch.push(dir);
  return dir;
}

/** A migrated application database with `users` accounts, left OPEN (so its WAL has not been checkpointed). */
function liveDatabase(dir: string, users: number): { path: string; db: Database.Database } {
  const path = join(dir, 'aivore.db');
  const db = createDb(path);
  runMigrations(db);
  for (let index = 0; index < users; index += 1) seedUser(db);
  openDatabases.push(db.$client);
  return { path, db: db.$client };
}

function writeMedia(dir: string): string[] {
  const long = `u/usr_01hzzzzzzzzzzzzzzzzzzzzzzz/gen_01hzzzzzzzzzzzzzzzzzzzzzzz/${'x'.repeat(60)}`;
  const files = [
    'u/usr_a/gen_a/ast_a.webp',
    'u/usr_a/gen_a/.ast_a.webp.meta',
    `${long}/ast_deeply_nested_with_a_very_long_name.mp4`,
  ];
  for (const file of files) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), `bytes of ${file}`);
  }
  return files;
}

function capture() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    io: {
      log: (line: string) => lines.push(line),
      error: (line: string) => errors.push(line),
    },
  };
}

function readManifest(dir: string): BackupManifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
}

describe('backup: the database', () => {
  it('takes a consistent, verified copy of a live WAL database without touching it', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 3);
    // The premise of the whole script: the recent commits are still in the -wal file.
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
    const before = statSync(path).mtimeMs;

    const out = join(dir, 'backups');
    const { dir: backupDir, manifest } = await backup.createBackup({
      database: path,
      media: null,
      out,
    });

    const copy = new Database(join(backupDir, 'aivore.db'), { readonly: true });
    try {
      expect((copy.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n).toBe(3);
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
    } finally {
      copy.close();
    }
    expect(manifest.format).toBe('aivore-backup/1');
    expect(manifest.database.tables.users).toBe(3);
    expect(manifest.database.integrityCheck).toBe('ok');
    expect(manifest.database.migrations?.count).toBeGreaterThan(0);
    expect(manifest.database.sha256).toBe(await backup.sha256File(join(backupDir, 'aivore.db')));
    expect(manifest.media).toBeNull();
    // A backup is one directory with exactly these files: no WAL sidecars, no temp leftovers.
    expect(readdirSync(backupDir).sort()).toEqual(['aivore.db', 'manifest.json']);
    expect(readdirSync(out)).toEqual([backup.backupName(new Date(manifest.createdAt))]);
    // The live database was only read.
    expect(statSync(path).mtimeMs).toBe(before);
    expect(
      (openDatabases[0]?.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n,
    ).toBe(3);
  });

  it('is a consistent snapshot while another process keeps writing', async () => {
    const dir = tempDir();
    const { path, db } = liveDatabase(dir, 1);
    db.exec('CREATE TABLE ping (n INTEGER NOT NULL)');
    db.close();

    const sqlite = createRequire(import.meta.url).resolve('better-sqlite3');
    const writer = spawn(
      process.execPath,
      [
        '-e',
        `
        const Database = require(${JSON.stringify(sqlite)});
        const db = new Database(${JSON.stringify(path)});
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        const insert = db.prepare('INSERT INTO ping (n) VALUES (?)');
        const deadline = Date.now() + 2500;
        let n = 0;
        while (Date.now() < deadline) {
          insert.run(n++);
          if (n === 20) console.log('ready');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        console.log('done ' + n);
        db.close();
      `,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let output = '';
    const ready = new Promise<void>((resolveReady) => {
      writer.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('ready')) resolveReady();
      });
    });
    const exited = new Promise<void>((resolveExit) => writer.on('close', () => resolveExit()));
    await ready;

    const { dir: backupDir } = await backup.createBackup({
      database: path,
      media: null,
      out: join(dir, 'backups'),
    });
    await exited;

    const total = Number(/done (\d+)/.exec(output)?.[1]);
    const copy = new Database(join(backupDir, 'aivore.db'), { readonly: true });
    try {
      const rows = (copy.prepare('SELECT count(*) AS n FROM ping').get() as { n: number }).n;
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
      // Taken in the middle of the writes: at least what was there when it started, less than the end.
      expect(rows).toBeGreaterThanOrEqual(20);
      expect(rows).toBeLessThan(total);
      // Whole transactions only: the values are the consecutive 0..rows-1.
      const max = (copy.prepare('SELECT max(n) AS m FROM ping').get() as { m: number }).m;
      expect(max).toBe(rows - 1);
    } finally {
      copy.close();
    }
  });

  it('leaves nothing behind when the database cannot be backed up', async () => {
    const dir = tempDir();
    const broken = join(dir, 'aivore.db');
    writeFileSync(broken, 'this is not a SQLite database, just some text '.repeat(100));
    const out = join(dir, 'backups');
    const { io, errors } = capture();

    const code = await backup.runBackup(['--db', broken, '--no-media', '--out', out], io);

    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/backup:/);
    expect(existsSync(out) ? readdirSync(out) : []).toEqual([]);
  });

  it('says which setting to fix when there is no database', async () => {
    const dir = tempDir();
    const { io, errors } = capture();

    const code = await backup.runBackup(['--no-media'], { ...io, env: {}, cwd: dir });

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('DATABASE_PATH');
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('backup: the media directory', () => {
  it('archives hidden files and long paths and records what is inside', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    const media = join(dir, 'media');
    const files = writeMedia(media);

    const { dir: backupDir, manifest } = await backup.createBackup({
      database: path,
      media,
      out: join(dir, 'backups'),
    });

    expect(manifest.media).toMatchObject({ file: 'media.tar', files: files.length });
    expect(manifest.media?.sha256).toBe(await backup.sha256File(join(backupDir, 'media.tar')));
    const { stdout } = await run('tar', ['-tf', join(backupDir, 'media.tar')]);
    for (const file of files) expect(stdout.split('\n')).toContain(`./${file}`);
  });

  it('skips a media directory that does not exist yet and says so', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    const { io, lines } = capture();

    const code = await backup.runBackup(
      ['--db', path, '--media', join(dir, 'never-created'), '--out', join(dir, 'backups')],
      io,
    );

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('does not exist, skipped');
    const [name] = backup.listBackups(join(dir, 'backups'));
    expect(readdirSync(join(dir, 'backups', name ?? ''))).not.toContain('media.tar');
  });

  it('refuses a backup directory inside the media directory (the archive would contain itself)', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    const media = join(dir, 'media');
    writeMedia(media);
    const { io, errors } = capture();

    const code = await backup.runBackup(
      ['--db', path, '--media', media, '--out', join(media, 'backups')],
      io,
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('inside the media directory');
    expect(existsSync(join(media, 'backups'))).toBe(false);
  });

  it('backs up only the database when the application stores media in S3', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    writeMedia(join(dir, 'media'));
    const { io, lines } = capture();

    const code = await backup.runBackup(['--out', join(dir, 'backups')], {
      ...io,
      cwd: dir,
      env: { DATABASE_PATH: path, STORAGE_DRIVER: 's3', STORAGE_LOCAL_DIR: join(dir, 'media') },
    });

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('STORAGE_DRIVER=s3');
    const [name] = backup.listBackups(join(dir, 'backups'));
    expect(readManifest(join(dir, 'backups', name ?? '')).media).toBeNull();
  });
});

describe('backup: Google Cloud Storage', () => {
  it('backs up only the database when the application stores media in a Google bucket', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    writeMedia(join(dir, 'media'));
    const { io, lines } = capture();

    const code = await backup.runBackup(['--out', join(dir, 'backups')], {
      ...io,
      cwd: dir,
      env: { DATABASE_PATH: path, STORAGE_DRIVER: 'gcs', STORAGE_LOCAL_DIR: join(dir, 'media') },
    });

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('STORAGE_DRIVER=gcs: media is not on this disk');
    const [name] = backup.listBackups(join(dir, 'backups'));
    expect(readManifest(join(dir, 'backups', name ?? '')).media).toBeNull();
  });

  it('still archives a media folder you name explicitly', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    writeMedia(join(dir, 'media'));
    const { io, lines } = capture();

    const code = await backup.runBackup(
      ['--out', join(dir, 'backups'), '--media', join(dir, 'media')],
      { ...io, cwd: dir, env: { DATABASE_PATH: path, STORAGE_DRIVER: 'gcs' } },
    );

    expect(code).toBe(0);
    expect(lines.join('\n')).not.toContain('media is not on this disk');
    const [name] = backup.listBackups(join(dir, 'backups'));
    expect(readManifest(join(dir, 'backups', name ?? '')).media).not.toBeNull();
  });
});

describe('backup: media left on the disk after the driver was switched', () => {
  // Switching to a bucket before `migrate:media` leaves every earlier picture only in the folder, and
  // a backup that says "media is not on this disk" would be untrue about exactly those files.
  const warningOf = (lines: string[]) => lines.filter((line) => line.startsWith('WARNING'));

  it.each(['gcs', 's3'])(
    'counts the files still in STORAGE_LOCAL_DIR and says they are NOT in the backup (%s)',
    async (driver) => {
      const dir = tempDir();
      const { path } = liveDatabase(dir, 1);
      const media = join(dir, 'media');
      writeMedia(media); // two pictures and one hidden sidecar, which is not counted
      const { io, lines } = capture();

      const code = await backup.runBackup(['--out', join(dir, 'backups')], {
        ...io,
        cwd: dir,
        env: { DATABASE_PATH: path, STORAGE_DRIVER: driver, STORAGE_LOCAL_DIR: media },
      });

      expect(code).toBe(0);
      const warnings = warningOf(lines);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('2 files');
      expect(warnings[0]).toContain(media);
      expect(warnings[0]).toContain('NOT in this backup');
      expect(warnings[0]).toContain('migrate:media');
      // Still only the database, as documented.
      const [name] = backup.listBackups(join(dir, 'backups'));
      expect(readManifest(join(dir, 'backups', name ?? '')).media).toBeNull();
    },
  );

  it('says nothing when the folder is empty or missing, and counts a single file in the singular', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    const env = { DATABASE_PATH: path, STORAGE_DRIVER: 'gcs', STORAGE_LOCAL_DIR: join(dir, 'm') };

    const missing = capture();
    await backup.runBackup(['--out', join(dir, 'backups')], { ...missing.io, cwd: dir, env });
    expect(warningOf(missing.lines)).toEqual([]);

    mkdirSync(join(dir, 'm', 'u'), { recursive: true });
    writeFileSync(join(dir, 'm', 'u', '.tmp-abc'), 'x');
    const hiddenOnly = capture();
    await backup.runBackup(['--out', join(dir, 'backups')], { ...hiddenOnly.io, cwd: dir, env });
    expect(warningOf(hiddenOnly.lines)).toEqual([]);

    writeFileSync(join(dir, 'm', 'u', 'ast_a.png'), 'x');
    const one = capture();
    await backup.runBackup(['--out', join(dir, 'backups')], { ...one.io, cwd: dir, env });
    expect(warningOf(one.lines)[0]).toContain('1 file in ');
    expect(warningOf(one.lines)[0]).toContain(' is NOT in this backup');
  });

  it('does not warn when the folder is archived (--media) or left out on purpose (--no-media)', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    const media = join(dir, 'media');
    writeMedia(media);
    const env = { DATABASE_PATH: path, STORAGE_DRIVER: 'gcs', STORAGE_LOCAL_DIR: media };

    const archived = capture();
    await backup.runBackup(['--out', join(dir, 'backups'), '--media', media], {
      ...archived.io,
      cwd: dir,
      env,
    });
    expect(warningOf(archived.lines)).toEqual([]);

    const skipped = capture();
    await backup.runBackup(['--out', join(dir, 'backups'), '--no-media'], {
      ...skipped.io,
      cwd: dir,
      env,
    });
    expect(warningOf(skipped.lines)).toEqual([]);
  });

  it('does not warn for a site that stores media on the disk', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    const media = join(dir, 'media');
    writeMedia(media);
    const { io, lines } = capture();
    await backup.runBackup(['--out', join(dir, 'backups')], {
      ...io,
      cwd: dir,
      env: { DATABASE_PATH: path, STORAGE_LOCAL_DIR: media },
    });
    expect(warningOf(lines)).toEqual([]);
  });
});

describe('backup: retention', () => {
  it('keeps the newest n complete backups and touches nothing else', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    const out = join(dir, 'backups');
    const start = Date.parse('2026-10-01T03:00:00Z');
    for (let day = 0; day < 5; day += 1) {
      await backup.createBackup(
        { database: path, media: null, out },
        { now: new Date(start + day * 86_400_000) },
      );
    }
    // Things that live in the same directory but are not complete backups of this program.
    mkdirSync(join(out, 'notes'));
    mkdirSync(join(out, 'aivore-not-a-timestamp'));
    mkdirSync(join(out, 'aivore-20200101T000000Z')); // looks like one, but has no manifest
    mkdirSync(join(out, 'aivore-20260101T000000Z.partial')); // a crashed run, long ago
    mkdirSync(join(out, 'aivore-20261008T000000Z.partial')); // a run that may still be going
    const old = new Date(Date.now() - 3 * 86_400_000);
    utimesSync(join(out, 'aivore-20260101T000000Z.partial'), old, old);

    const { removed } = backup.pruneBackups(out, 2);

    expect(backup.listBackups(out)).toEqual(['aivore-20261004T030000Z', 'aivore-20261005T030000Z']);
    expect(removed).toContain('aivore-20261001T030000Z');
    expect(removed).toContain('aivore-20260101T000000Z.partial');
    expect(readdirSync(out).sort()).toEqual([
      'aivore-20200101T000000Z',
      'aivore-20261004T030000Z',
      'aivore-20261005T030000Z',
      'aivore-20261008T000000Z.partial',
      'aivore-not-a-timestamp',
      'notes',
    ]);
  });

  it('applies --keep after a new backup was written, and rejects values that would delete everything', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);
    const out = join(dir, 'backups');
    const base = ['--db', path, '--no-media', '--out', out];
    const start = Date.parse('2026-10-01T03:00:00Z');
    for (let day = 0; day < 3; day += 1) {
      expect(
        await backup.runBackup([...base, '--keep', '2'], {
          ...capture().io,
          now: new Date(start + day * 86_400_000),
        }),
      ).toBe(0);
    }
    expect(backup.listBackups(out)).toEqual(['aivore-20261002T030000Z', 'aivore-20261003T030000Z']);

    for (const bad of ['0', '-1', '1.5', 'many']) {
      const { io, errors } = capture();
      expect(await backup.runBackup([...base, '--keep', bad], io)).toBe(2);
      expect(errors.join('\n')).toContain('--keep');
    }
    expect(backup.listBackups(out)).toHaveLength(2);
  });
});

describe('backup: command line', () => {
  it('uses the environment the application reads and puts backups next to the database', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 2);
    const media = join(dir, 'media');
    writeMedia(media);
    const { io, lines } = capture();

    const code = await backup.runBackup([], {
      ...io,
      cwd: dir,
      env: { DATABASE_PATH: path, STORAGE_LOCAL_DIR: media, STORAGE_DRIVER: 'local' },
    });

    expect(code).toBe(0);
    const [name] = backup.listBackups(join(dir, 'backups'));
    expect(name).toMatch(/^aivore-\d{8}T\d{6}Z$/);
    expect(lines.at(-1)).toBe(`Backup written: ${join(dir, 'backups', name ?? '')}`);
    expect(readManifest(join(dir, 'backups', name ?? '')).media?.files).toBe(3);
  });

  it('rejects unknown and incomplete arguments with exit code 2', async () => {
    for (const argv of [['--nope'], ['--out'], ['--keep'], ['positional']]) {
      const { io, errors } = capture();
      expect(await backup.runBackup(argv, io)).toBe(2);
      expect(errors.join('\n')).toContain('Usage:');
    }
  });

  it('prints its usage for --help', async () => {
    const { io, lines } = capture();
    expect(await backup.runBackup(['--help'], io)).toBe(0);
    expect(lines.join('\n')).toContain('--keep <n>');
  });

  it('works as a real process, the way `npm run backup` and docker exec run it', async () => {
    const dir = tempDir();
    const { path } = liveDatabase(dir, 1);

    const { stdout } = await run(process.execPath, ['scripts/backup.mjs', '--no-media'], {
      cwd: ROOT,
      env: { NODE_ENV: 'test', PATH: process.env.PATH, DATABASE_PATH: path },
      timeout: 60_000,
    });

    expect(stdout).toContain('Backup written:');
    expect(backup.listBackups(join(dir, 'backups'))).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('names backups by UTC time so the names sort chronologically', () => {
    expect(backup.backupName(new Date('2026-10-09T03:45:00.123Z'))).toBe('aivore-20261009T034500Z');
    const names = ['2026-10-09T03:45:00Z', '2026-10-09T13:00:00Z', '2027-01-01T00:00:00Z'].map(
      (iso) => backup.backupName(new Date(iso)),
    );
    expect([...names].sort()).toEqual(names);
  });

  it('knows what lies inside a directory', () => {
    expect(backup.isInside('/data/media', '/data/media/backups')).toBe(true);
    expect(backup.isInside('/data/media', '/data/media')).toBe(true);
    expect(backup.isInside('/data/media', '/data/media-other')).toBe(false);
    expect(backup.isInside('/data/media', '/data/backups')).toBe(false);
    expect(backup.isInside('/data/media', '/data/..hidden')).toBe(false);
  });

  it('formats sizes for people', () => {
    expect(backup.formatBytes(512)).toBe('512 B');
    expect(backup.formatBytes(1536)).toBe('1.5 KiB');
    expect(backup.formatBytes(5 * 1024 * 1024)).toBe('5.0 MiB');
  });

  it('reports a file that is not a database as failing, without throwing', () => {
    const dir = tempDir();
    const file = join(dir, 'x.db');
    writeFileSync(file, 'plain text, long enough to be a page'.repeat(200));
    const result = backup.checkIntegrity(file);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toMatch(/not a database|malformed/i);
  });
});
