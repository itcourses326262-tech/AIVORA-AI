import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '@/server/db';
import { runMigrations } from '@/server/db/migrate';
import { seedUser } from '../helpers/db';

const ROOT = resolve(import.meta.dirname, '../..');

interface Io {
  env?: Record<string, string | undefined>;
  cwd?: string;
  log?: (line: string) => void;
  error?: (line: string) => void;
  now?: Date;
}

interface BackupModule {
  runBackup(argv: string[], io?: Io): Promise<number>;
  listBackups(dir: string): string[];
  sha256File(path: string): Promise<string>;
}

interface RestoreModule {
  runRestore(argv: string[], io?: Io): Promise<number>;
}

const backup = (await import(
  /* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts/backup.mjs')).href
)) as BackupModule;
const restore = (await import(
  /* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts/restore.mjs')).href
)) as RestoreModule;

const scratch: string[] = [];
const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) if (db.open) db.close();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aivore-restore-test-'));
  scratch.push(dir);
  return dir;
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

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function countUsers(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/** A server with `users` accounts and two media files; the database is left open, like a running app. */
function server(dir: string, users: number) {
  const database = join(dir, 'server', 'aivore.db');
  const media = join(dir, 'server', 'media');
  const db = createDb(database);
  runMigrations(db);
  for (let index = 0; index < users; index += 1) seedUser(db);
  openDatabases.push(db.$client);
  mkdirSync(join(media, 'u', 'usr_a'), { recursive: true });
  writeFileSync(join(media, 'u', 'usr_a', 'ast_a.webp'), 'first picture');
  writeFileSync(join(media, 'u', 'usr_a', '.ast_a.webp.meta'), '{"mime":"image/webp"}');
  return { database, media, db: db.$client };
}

/** Makes a backup of `source` into `<dir>/backups` and returns its directory. */
async function takeBackup(
  dir: string,
  source: { database: string; media: string },
): Promise<string> {
  const out = join(dir, 'backups');
  const { io, errors } = capture();
  const code = await backup.runBackup(
    ['--db', source.database, '--media', source.media, '--out', out],
    io,
  );
  expect(errors).toEqual([]);
  expect(code).toBe(0);
  const [name] = backup.listBackups(out).slice(-1);
  return join(out, name ?? '');
}

function rewriteManifest(
  dir: string,
  change: (manifest: Record<string, Record<string, unknown>>) => void,
) {
  const path = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<
    string,
    Record<string, unknown>
  >;
  change(manifest);
  writeFileSync(path, JSON.stringify(manifest));
}

describe('restore: the round trip', () => {
  it('restores the database and the media of a backup into a new place', async () => {
    const dir = tempDir();
    const source = server(dir, 4);
    const backupDir = await takeBackup(dir, source);
    const target = { database: join(dir, 'new', 'aivore.db'), media: join(dir, 'new', 'media') };
    const { io, lines, errors } = capture();

    const code = await restore.runRestore(
      ['--from', backupDir, '--db', target.database, '--media', target.media],
      io,
    );

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    expect(countUsers(target.database)).toBe(4);
    const restored = new Database(target.database, { readonly: true });
    try {
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      restored.close();
    }
    expect(readFileSync(join(target.media, 'u', 'usr_a', 'ast_a.webp'), 'utf8')).toBe(
      'first picture',
    );
    expect(existsSync(join(target.media, 'u', 'usr_a', '.ast_a.webp.meta'))).toBe(true);
    // Backups hold personal data: the restored database is private to its owner.
    expect(statSync(target.database).mode & 0o077).toBe(0);
    expect(lines.join('\n')).toContain('users 4');
    expect(lines.at(-1)).toContain('SESSION_SECRET');
    // No staging file is left next to it.
    expect(readdirSync(join(dir, 'new')).sort()).toEqual(['aivore.db', 'media']);
  });

  it('restores from the newest backup with --latest', async () => {
    const dir = tempDir();
    const source = server(dir, 1);
    await takeBackup(dir, source);
    // A newer name without a manifest is not a complete backup and must not win.
    mkdirSync(join(dir, 'backups', 'aivore-20990101T000000Z'));
    const target = join(dir, 'new', 'aivore.db');
    const { io, errors } = capture();

    const code = await restore.runRestore(
      ['--latest', '--out', join(dir, 'backups'), '--db', target, '--no-media'],
      io,
    );

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    expect(countUsers(target)).toBe(1);
  });

  it('only verifies with --check and changes nothing', async () => {
    const dir = tempDir();
    const source = server(dir, 1);
    const backupDir = await takeBackup(dir, source);
    const target = join(dir, 'new', 'aivore.db');
    const { io, lines } = capture();

    const code = await restore.runRestore(['--from', backupDir, '--db', target, '--check'], io);

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('Check only: nothing was changed.');
    expect(existsSync(join(dir, 'new'))).toBe(false);
  });
});

describe('restore: it will not overwrite by accident', () => {
  it('refuses an existing database without --force and leaves it exactly as it was', async () => {
    const dir = tempDir();
    const source = server(dir, 2);
    const backupDir = await takeBackup(dir, source);
    const target = join(dir, 'new', 'aivore.db');
    mkdirSync(join(dir, 'new'));
    writeFileSync(target, 'precious data');
    const { io, errors } = capture();

    const code = await restore.runRestore(['--from', backupDir, '--db', target, '--no-media'], io);

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('--force');
    expect(readFileSync(target, 'utf8')).toBe('precious data');
    expect(readdirSync(join(dir, 'new'))).toEqual(['aivore.db']);
  });

  it('refuses a non-empty media directory without --force before it changes the database', async () => {
    const dir = tempDir();
    const source = server(dir, 2);
    const backupDir = await takeBackup(dir, source);
    const target = { database: join(dir, 'new', 'aivore.db'), media: join(dir, 'new', 'media') };
    mkdirSync(target.media, { recursive: true });
    writeFileSync(join(target.media, 'already-here.webp'), 'x');
    const { io, errors } = capture();

    const code = await restore.runRestore(
      ['--from', backupDir, '--db', target.database, '--media', target.media],
      io,
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('is not empty');
    expect(existsSync(target.database)).toBe(false);
  });

  it('with --force moves the old database and its WAL files aside instead of deleting or mixing them', async () => {
    const dir = tempDir();
    const source = server(dir, 5);
    const backupDir = await takeBackup(dir, source);

    // The "damaged production" database: other data, with a WAL file that is not checkpointed.
    const target = join(dir, 'prod', 'aivore.db');
    const old = createDb(target);
    runMigrations(old);
    seedUser(old);
    openDatabases.push(old.$client);
    expect(statSync(`${target}-wal`).size).toBeGreaterThan(0);
    old.$client.close();
    writeFileSync(`${target}-wal`, 'stale wal that must never be replayed into the restored file');
    const { io, errors } = capture();

    const code = await restore.runRestore(
      ['--from', backupDir, '--db', target, '--no-media', '--force'],
      { ...io, now: new Date('2026-10-09T04:00:00Z') },
    );

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    expect(countUsers(target)).toBe(5);
    expect(readdirSync(join(dir, 'prod')).sort()).toEqual([
      'aivore.db',
      'aivore.db-wal.pre-restore-20261009T040000Z',
      'aivore.db.pre-restore-20261009T040000Z',
    ]);
    expect(countUsers(`${target}.pre-restore-20261009T040000Z`)).toBe(1);
  });

  it('extracts media over an existing directory with --force and deletes nothing in it', async () => {
    const dir = tempDir();
    const source = server(dir, 1);
    const backupDir = await takeBackup(dir, source);
    const target = { database: join(dir, 'new', 'aivore.db'), media: join(dir, 'new', 'media') };
    mkdirSync(target.media, { recursive: true });
    writeFileSync(join(target.media, 'made-after-the-backup.webp'), 'newer');

    const code = await restore.runRestore(
      ['--from', backupDir, '--db', target.database, '--media', target.media, '--force'],
      capture().io,
    );

    expect(code).toBe(0);
    expect(readFileSync(join(target.media, 'made-after-the-backup.webp'), 'utf8')).toBe('newer');
    expect(readFileSync(join(target.media, 'u', 'usr_a', 'ast_a.webp'), 'utf8')).toBe(
      'first picture',
    );
  });

  it('refuses to restore a backup onto itself', async () => {
    const dir = tempDir();
    const source = server(dir, 1);
    const backupDir = await takeBackup(dir, source);
    const { io, errors } = capture();

    const code = await restore.runRestore(
      ['--from', backupDir, '--db', join(backupDir, 'aivore.db'), '--no-media', '--force'],
      io,
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('the backup file itself');
  });
});

describe('restore: it only accepts a backup that verifies', () => {
  async function refuses(backupDir: string, pattern: RegExp) {
    const dir = tempDir();
    const target = join(dir, 'new', 'aivore.db');
    const media = join(dir, 'new', 'media');
    const { io, errors } = capture();
    const code = await restore.runRestore(
      ['--from', backupDir, '--db', target, '--media', media],
      io,
    );
    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(pattern);
    // Nothing was created at the target: refusal happens before the first change.
    expect(existsSync(join(dir, 'new'))).toBe(false);
  }

  it('refuses a database that was changed after the backup (checksum)', async () => {
    const dir = tempDir();
    const backupDir = await takeBackup(dir, server(dir, 2));
    writeFileSync(
      join(backupDir, 'aivore.db'),
      Buffer.concat([readFileSync(join(backupDir, 'aivore.db')), Buffer.from('x')]),
    );
    await refuses(backupDir, /does not match the checksum/);
  });

  it('refuses a database that is not intact even when its checksum was rewritten to match', async () => {
    const dir = tempDir();
    const backupDir = await takeBackup(dir, server(dir, 2));
    const damaged = readFileSync(join(backupDir, 'aivore.db'));
    damaged.fill(0xff, 4096, 8192); // the second page
    writeFileSync(join(backupDir, 'aivore.db'), damaged);
    rewriteManifest(backupDir, (manifest) => {
      (manifest.database as Record<string, unknown>).sha256 = sha256(join(backupDir, 'aivore.db'));
    });
    await refuses(backupDir, /integrity check|not a database|malformed/i);
  });

  it('refuses a damaged media archive', async () => {
    const dir = tempDir();
    const backupDir = await takeBackup(dir, server(dir, 1));
    writeFileSync(join(backupDir, 'media.tar'), 'not a tar archive'.repeat(100));
    await refuses(backupDir, /does not match the checksum/);
  });

  it('refuses a media archive that would write outside the media directory', async () => {
    const dir = tempDir();
    const backupDir = await takeBackup(dir, server(dir, 1));
    // A hand-made ustar archive with one entry named "../escaped.txt" (and a matching manifest).
    const header = Buffer.alloc(512);
    header.write('../escaped.txt', 0, 'ascii');
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write('00000000000\0', 124, 'ascii');
    header.write('00000000000\0', 136, 'ascii');
    header.write('        ', 148, 'ascii');
    header.write('0', 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
    writeFileSync(join(backupDir, 'media.tar'), Buffer.concat([header, Buffer.alloc(1024)]));
    rewriteManifest(backupDir, (manifest) => {
      (manifest.media as Record<string, unknown>).sha256 = sha256(join(backupDir, 'media.tar'));
    });
    await refuses(backupDir, /unsafe path/);
  });

  it('refuses a directory that is not a backup, and a manifest it does not understand', async () => {
    const dir = tempDir();
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    await refuses(empty, /not a backup/);

    const backupDir = await takeBackup(dir, server(dir, 1));
    rewriteManifest(backupDir, (manifest) => {
      (manifest as Record<string, unknown>).format = 'aivore-backup/99';
    });
    await refuses(backupDir, /format/);
  });

  it('refuses a manifest that names a file outside the backup directory', async () => {
    const dir = tempDir();
    const backupDir = await takeBackup(dir, server(dir, 1));
    rewriteManifest(backupDir, (manifest) => {
      (manifest.database as Record<string, unknown>).file = '../../etc/passwd';
    });
    await refuses(backupDir, /plain file name/);
  });

  it('needs exactly one of --from and --latest, and says when there is no backup to use', async () => {
    const dir = tempDir();
    for (const argv of [[], ['--from', dir, '--latest']]) {
      const { io, errors } = capture();
      expect(await restore.runRestore(argv, io)).toBe(2);
      expect(errors.join('\n')).toContain('exactly one of');
    }
    const { io, errors } = capture();
    expect(await restore.runRestore(['--latest', '--out', join(dir, 'none')], io)).toBe(1);
    expect(errors.join('\n')).toContain('No complete backup found');
  });
});
