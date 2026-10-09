#!/usr/bin/env node
// Consistent backup of an AIVORE installation: the SQLite database and, optionally, the media directory.
//
//   npm run backup -- [--out <dir>] [--keep <n>] [--no-media]
//   docker compose exec app node scripts/backup.mjs --keep 14
//
// The database is copied with SQLite's online backup API (better-sqlite3 `db.backup()`), never by copying
// the file: a live database in WAL mode keeps recent commits in the `-wal` file, and a plain copy taken
// while the app writes can be torn or miss them. The copy is one consistent snapshot, the app keeps
// running, and nothing is written to the live database. The copy is then verified with
// `PRAGMA integrity_check` and its sha256 is recorded.
//
// One backup is one directory, written as `<name>.partial` and renamed only when everything in it was
// verified, so a crashed run never leaves something that looks like a good backup:
//
//   backups/aivore-20261009T034500Z/
//     aivore.db        the database (rollback-journal mode, a single self-contained file)
//     media.tar        the media directory, when there is one (plain tar, media is already compressed)
//     manifest.json    format, sizes, sha256 of each file, row counts, migrations
//
// Media is archived with the system `tar` (present in the Docker image, macOS, Linux and Windows 10+).
// With STORAGE_DRIVER=s3 or gcs there is no local media: back the bucket up with its own versioning/replication.
// Files that are still in STORAGE_LOCAL_DIR (the driver was switched before `migrate:media` ran) are not
// archived either, but they are counted and the run says that they are NOT in the backup.
//
// Options (defaults from the same environment variables the app reads):
//   --db <path>      database file                         DATABASE_PATH, ./data/aivore.db
//   --media <dir>    media directory to archive            STORAGE_LOCAL_DIR, ./data/media
//   --no-media       back up the database only
//   --out <dir>      where backups are collected           <database directory>/backups
//   --keep <n>       afterwards keep only the newest n complete backups in --out (n >= 1)
//   --help
//
// Exit codes: 0 done, 1 failed (nothing usable was left behind), 2 wrong usage.
//
// Backups contain personal data (emails, password hashes, generated media): the directories are created
// with mode 0700 and the files 0600. They do NOT contain SESSION_SECRET or any other secret; keep the
// secret in your secret store, a restored database needs the same SESSION_SECRET (see docs/OPERATIONS.md).

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export const BACKUP_FORMAT = 'aivore-backup/1';
export const DB_FILE = 'aivore.db';
export const MEDIA_FILE = 'media.tar';
export const MANIFEST_FILE = 'manifest.json';
export const BACKUP_NAME = /^aivore-\d{8}T\d{6}Z$/;
const PARTIAL_NAME = /^aivore-\d{8}T\d{6}Z\.partial$/;
const PARTIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DATABASE = './data/aivore.db';
const DEFAULT_MEDIA = './data/media';
/** The most pages one `backup.transfer` call may copy: all of them in a single, snapshot-consistent step. */
const ALL_PAGES = 0x7fffffff;

/** A problem the operator can fix; its message is printed as it is, without a stack trace. */
export class BackupError extends Error {
  /** @param {string} message @param {number} [exitCode] */
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'BackupError';
    this.exitCode = exitCode;
  }
}

const USAGE = `Usage: node scripts/backup.mjs [options]

  --db <path>      database file (default: DATABASE_PATH or ${DEFAULT_DATABASE})
  --media <dir>    media directory (default: STORAGE_LOCAL_DIR or ${DEFAULT_MEDIA})
  --no-media       back up the database only
  --out <dir>      collect backups here (default: <database directory>/backups)
  --keep <n>       afterwards keep only the newest n complete backups in --out
  --help           show this text
`;

/** Blank environment values count as unset, like in the application. */
function fromEnv(env, name) {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 */
export function parseBackupArgs(argv, env, cwd) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  const valued = new Set(['db', 'media', 'out', 'keep']);
  const switches = new Set(['no-media', 'help']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const name = arg.startsWith('--') ? arg.slice(2) : '';
    if (switches.has(name)) {
      flags[name] = true;
    } else if (valued.has(name)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new BackupError(`--${name} needs a value\n\n${USAGE}`, 2);
      }
      flags[name] = value;
      index += 1;
    } else {
      throw new BackupError(`Unknown argument: ${arg}\n\n${USAGE}`, 2);
    }
  }
  if (flags.help === true) return { help: true };

  let keep;
  if (typeof flags.keep === 'string') {
    keep = Number(flags.keep);
    if (!Number.isInteger(keep) || keep < 1) {
      throw new BackupError('--keep must be a whole number of at least 1', 2);
    }
  }
  const at = (value) => resolve(cwd, value);
  const database = at(String(flags.db ?? fromEnv(env, 'DATABASE_PATH') ?? DEFAULT_DATABASE));
  const explicitMedia = typeof flags.media === 'string';
  const driver = fromEnv(env, 'STORAGE_DRIVER');
  const remote = driver === 's3' || driver === 'gcs';
  const media =
    flags['no-media'] === true || (remote && !explicitMedia)
      ? null
      : at(String(flags.media ?? fromEnv(env, 'STORAGE_LOCAL_DIR') ?? DEFAULT_MEDIA));
  const remoteSkipped = remote && !explicitMedia && flags['no-media'] !== true;
  return {
    help: false,
    database,
    media,
    remoteDriverSkipped: remoteSkipped ? String(driver) : null,
    // Where the files of a site that used the disk before the switch would still be.
    leftoverMediaDir: remoteSkipped ? at(fromEnv(env, 'STORAGE_LOCAL_DIR') ?? DEFAULT_MEDIA) : null,
    out: at(String(flags.out ?? join(dirname(database), 'backups'))),
    keep,
  };
}

/** `aivore-20261009T034500Z` for a UTC date. */
export function backupName(date) {
  const stamp = date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
  return `aivore-${stamp}`;
}

/** sha256 (hex) of a file, streamed. */
export function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolveHash(hash.digest('hex')));
  });
}

/**
 * `PRAGMA integrity_check` of a database file, opened read-only. A file that is not a database is
 * reported as a failed check, not thrown.
 * @returns {{ ok: boolean, messages: string[] }}
 */
export function checkIntegrity(path) {
  let db;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const rows = db.pragma('integrity_check');
    const messages = rows.map((row) => String(row.integrity_check));
    return { ok: messages.length === 1 && messages[0] === 'ok', messages };
  } catch (error) {
    return { ok: false, messages: [error instanceof Error ? error.message : String(error)] };
  } finally {
    db?.close();
  }
}

/**
 * Row counts of every table and the applied migrations of a database file; what a person compares
 * after a restore. Read-only.
 */
export function describeDatabase(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    /** @type {Record<string, number>} */
    const tables = {};
    for (const name of names) {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      tables[name] = Number(db.prepare(`SELECT count(*) AS n FROM ${quoted}`).get().n);
    }
    let migrations = null;
    if (names.includes('__drizzle_migrations')) {
      const row = db
        .prepare('SELECT count(*) AS n, max(created_at) AS latest FROM __drizzle_migrations')
        .get();
      migrations = {
        count: Number(row.n),
        latest: row.latest === null ? null : Number(row.latest),
      };
    }
    return { tables, migrations };
  } finally {
    db.close();
  }
}

/** The system `tar`: whether it exists and whether it is GNU tar (which exits 1 for a file that changed while read). */
export function findTar() {
  const probe = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return { available: false, gnu: false };
  return { available: true, gnu: /GNU tar/.test(probe.stdout) };
}

/**
 * Runs tar and collects the end of its error output. `onLine` receives every line of stdout (for
 * archive listings, which can be very long).
 * @param {string[]} args
 * @param {(line: string) => void} [onLine]
 */
export function runTar(args, onLine) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => onLine?.(line));
    child.on('error', reject);
    child.on('close', (code) => resolveRun({ code: code ?? 1, stderr: stderr.trim() }));
  });
}

/**
 * Lists a tar archive. Returns the number of files and refuses names that would leave the target
 * directory (absolute paths, `..`), which only a tampered archive contains.
 */
export async function listArchive(archive) {
  let files = 0;
  /** @type {string | undefined} */
  let unsafe;
  const { code, stderr } = await runTar(['-tf', archive], (line) => {
    const name = line.replaceAll('\\', '/');
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) {
      unsafe ??= line;
    }
    if (!name.endsWith('/')) files += 1;
  });
  if (unsafe !== undefined) {
    throw new BackupError(`The media archive contains an unsafe path (${unsafe}); not using it`);
  }
  if (code !== 0)
    throw new BackupError(`The media archive cannot be read: ${stderr || `tar exited ${code}`}`);
  return { files };
}

function syncPath(path) {
  try {
    const fd = openSync(path, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Not every platform can sync a directory; the data itself was written and closed already.
  }
}

/** Complete backups (strict name, manifest present) in `dir`, oldest first. */
export function listBackups(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && BACKUP_NAME.test(entry.name))
    .filter((entry) => existsSync(join(dir, entry.name, MANIFEST_FILE)))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Keeps the newest `keep` complete backups of `dir` and deletes the rest, and half-written
 * `.partial` directories older than a day. Only names that match the backup pattern are touched.
 * @returns {{ removed: string[] }}
 */
export function pruneBackups(dir, keep, now = Date.now()) {
  const removed = [];
  const complete = listBackups(dir);
  for (const name of complete.slice(0, Math.max(0, complete.length - keep))) {
    rmSync(join(dir, name), { recursive: true, force: true });
    removed.push(name);
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !PARTIAL_NAME.test(entry.name)) continue;
    const age = now - statSync(join(dir, entry.name)).mtimeMs;
    if (age > PARTIAL_MAX_AGE_MS) {
      rmSync(join(dir, entry.name), { recursive: true, force: true });
      removed.push(entry.name);
    }
  }
  return { removed };
}

/** Whether `inner` is `outer` or lies inside it. */
export function isInside(outer, inner) {
  const path = relative(resolve(outer), resolve(inner));
  return path === '' || (!isAbsolute(path) && path.split(sep)[0] !== '..');
}

/**
 * Makes one backup. Resolves with the final directory and the manifest.
 * @param {{ database: string, media: string | null, out: string, keep?: number }} options
 * @param {{ now?: Date, log?: (line: string) => void }} [hooks]
 */
export async function createBackup(options, hooks = {}) {
  const log = hooks.log ?? (() => {});
  const { database, media, out, keep } = options;
  if (!existsSync(database) || !statSync(database).isFile()) {
    throw new BackupError(
      `No database at ${database}. Set DATABASE_PATH or pass --db <path> (in Docker: run it inside the app container).`,
    );
  }
  if (media !== null && isInside(media, out)) {
    throw new BackupError(
      `The backup directory ${out} is inside the media directory ${media}; choose another --out`,
    );
  }
  const tar = media !== null && existsSync(media) ? findTar() : null;
  if (tar !== null && !tar.available) {
    throw new BackupError(
      'The media directory needs the "tar" program, which is not installed. Install it, or back up the database only with --no-media and copy the media directory yourself.',
    );
  }

  const name = backupName(hooks.now ?? new Date());
  const finalDir = join(out, name);
  const partialDir = `${finalDir}.partial`;
  if (existsSync(finalDir) || existsSync(partialDir)) {
    throw new BackupError(
      `${finalDir} already exists (two backups in the same second?); try again`,
    );
  }
  mkdirSync(out, { recursive: true, mode: 0o700 });
  mkdirSync(partialDir, { mode: 0o700 });

  try {
    // 1. The database, as one consistent snapshot.
    const dbTarget = join(partialDir, DB_FILE);
    const source = new Database(database, { readonly: true, fileMustExist: true, timeout: 5000 });
    try {
      await source.backup(dbTarget, { progress: () => ALL_PAGES });
    } finally {
      source.close();
    }
    // A single self-contained file: no `-wal`/`-shm` next to it, readable from a read-only mount. The
    // application switches the restored file back to WAL when it opens it.
    const copy = new Database(dbTarget, { fileMustExist: true });
    try {
      copy.pragma('journal_mode = DELETE');
    } finally {
      copy.close();
    }
    const integrity = checkIntegrity(dbTarget);
    if (!integrity.ok) {
      throw new BackupError(
        `The backup copy failed its integrity check, so it was discarded: ${integrity.messages.slice(0, 3).join('; ')}`,
      );
    }
    const described = describeDatabase(dbTarget);
    chmodSync(dbTarget, 0o600);
    const dbBytes = statSync(dbTarget).size;
    const dbSha = await sha256File(dbTarget);
    log(
      `database  ${formatBytes(dbBytes)}  integrity ok  ${Object.keys(described.tables).length} tables`,
    );

    // 2. The media directory.
    let mediaEntry = null;
    if (media !== null && tar !== null) {
      const mediaTarget = join(partialDir, MEDIA_FILE);
      const { code, stderr } = await runTar(['-cf', mediaTarget, '-C', media, '.']);
      // GNU tar exits 1 when a file changed or vanished while it was read (a temporary file of an
      // upload that finished meanwhile); the archive is complete for everything else.
      const tolerated = code === 1 && tar.gnu;
      if (code !== 0 && !tolerated) {
        throw new BackupError(`tar failed while archiving ${media}: ${stderr || `exit ${code}`}`);
      }
      if (tolerated)
        log(
          `media: tar reported changes while it read the directory (${stderr.split('\n')[0] ?? ''})`,
        );
      const { files } = await listArchive(mediaTarget);
      chmodSync(mediaTarget, 0o600);
      mediaEntry = {
        file: MEDIA_FILE,
        bytes: statSync(mediaTarget).size,
        sha256: await sha256File(mediaTarget),
        files,
      };
      log(`media     ${formatBytes(mediaEntry.bytes)}  ${files} files`);
    } else if (media !== null) {
      log(`media     ${media} does not exist, skipped`);
    }

    // 3. The manifest, then the atomic rename that makes the backup visible.
    const manifest = {
      format: BACKUP_FORMAT,
      createdAt: (hooks.now ?? new Date()).toISOString(),
      database: {
        file: DB_FILE,
        bytes: dbBytes,
        sha256: dbSha,
        integrityCheck: 'ok',
        migrations: described.migrations,
        tables: described.tables,
      },
      media: mediaEntry,
    };
    const manifestPath = join(partialDir, MANIFEST_FILE);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    syncPath(manifestPath);
    syncPath(partialDir);
    renameSync(partialDir, finalDir);
    syncPath(out);

    let removed = [];
    if (keep !== undefined)
      removed = pruneBackups(out, keep, (hooks.now ?? new Date()).getTime()).removed;
    return { dir: finalDir, manifest, removed };
  } catch (error) {
    // Only the directory this run created, and only when its name proves it.
    if (PARTIAL_NAME.test(basename(partialDir)))
      rmSync(partialDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * How many media files are on disk under `dir`: plain files, without the hidden bookkeeping files of
 * the local driver and without links, exactly what `migrate:media` would copy. 0 for a missing folder.
 * @param {string} dir
 */
export function countMediaFiles(dir) {
  let count = 0;
  /** @param {string} directory */
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) walk(join(directory, entry.name));
      else if (entry.isFile()) count += 1;
    }
  };
  walk(dir);
  return count;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/**
 * The command, with its streams injectable for tests. Resolves with the exit code.
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, log?: (line: string) => void, error?: (line: string) => void, now?: Date }} [io]
 */
export async function runBackup(argv, io = {}) {
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const error = io.error ?? ((line) => process.stderr.write(`${line}\n`));
  try {
    const options = parseBackupArgs(argv, env, io.cwd ?? process.cwd());
    if (options.help) {
      log(USAGE.trimEnd());
      return 0;
    }
    if (options.remoteDriverSkipped) {
      log(
        `STORAGE_DRIVER=${options.remoteDriverSkipped}: media is not on this disk, only the database is backed up.`,
      );
      // Flipping the driver before `migrate:media` leaves every earlier picture only in this folder.
      const left = options.leftoverMediaDir ? countMediaFiles(options.leftoverMediaDir) : 0;
      if (left > 0) {
        const one = left === 1;
        log(
          `WARNING: ${left} ${one ? 'file' : 'files'} in ${options.leftoverMediaDir} ${one ? 'is' : 'are'} NOT in this backup. ` +
            `Unless \`npm run migrate:media\` copied ${one ? 'it' : 'them'} to the bucket, ${one ? 'it exists' : 'they exist'} nowhere else: ` +
            'run that first, or add --media <dir> to archive the folder too.',
        );
      }
    }
    const result = await createBackup(options, { log: (line) => log(`  ${line}`), now: io.now });
    log(`Backup written: ${result.dir}`);
    if (result.removed.length > 0)
      log(`Removed ${result.removed.length} older: ${result.removed.join(', ')}`);
    return 0;
  } catch (failure) {
    if (failure instanceof BackupError) {
      error(`backup: ${failure.message}`);
      return failure.exitCode;
    }
    error(
      `backup: unexpected error: ${failure instanceof Error ? (failure.stack ?? failure.message) : String(failure)}`,
    );
    return 1;
  }
}

/** Reads and checks a backup's manifest. */
export function readManifest(dir) {
  const path = join(dir, MANIFEST_FILE);
  if (!existsSync(path)) {
    throw new BackupError(`${dir} is not a backup: there is no ${MANIFEST_FILE} in it`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new BackupError(`${path} is not valid JSON`);
  }
  if (manifest?.format !== BACKUP_FORMAT) {
    throw new BackupError(
      `${path} has format ${JSON.stringify(manifest?.format)}; this script reads ${BACKUP_FORMAT}`,
    );
  }
  const files = [manifest.database, manifest.media].filter((entry) => entry != null);
  for (const entry of files) {
    if (
      typeof entry.file !== 'string' ||
      basename(entry.file) !== entry.file ||
      typeof entry.sha256 !== 'string'
    ) {
      throw new BackupError(`${path} names a file that is not a plain file name`);
    }
  }
  if (manifest.database == null) throw new BackupError(`${path} has no database entry`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBackup(process.argv.slice(2));
}
