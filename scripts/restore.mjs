#!/usr/bin/env node
// Restores a backup made by scripts/backup.mjs: the database and, when the backup has one, the media.
//
//   npm run restore -- --from backups/aivore-20261009T034500Z --force
//   docker compose stop app && docker compose run --rm --no-deps app node scripts/restore.mjs --latest --force
//
// STOP THE APPLICATION FIRST. The script cannot tell whether a process still has the database open;
// replacing the file under a running server corrupts what it keeps in memory and in the `-wal` file.
//
// Nothing is touched until every check has passed:
//   1. the manifest is read, the sha256 of every file is compared with it, and `PRAGMA integrity_check`
//      runs on the backup's database (a damaged or tampered backup is refused);
//   2. the media archive is listed and refused if it holds an absolute path or `..`;
//   3. an existing database or a non-empty media directory at the target is refused unless --force.
// Only then the database is copied next to its target, verified again, and renamed into place. With
// --force the old database is not deleted: it is moved aside as `<name>.pre-restore-<time>` together with
// its `-wal`/`-shm` files (a stale `-wal` next to a restored file would be replayed into it). Media is
// extracted over the target directory; files that are not in the backup are left alone, nothing is
// ever deleted from it.
//
// Options (defaults from the environment the application reads):
//   --from <dir>     the backup directory (aivore-YYYYMMDDTHHMMSSZ)
//   --latest         use the newest complete backup in --out instead of --from
//   --out <dir>      where backups are collected, for --latest   <database directory>/backups
//   --db <path>      restore the database here             DATABASE_PATH, ./data/aivore.db
//   --media <dir>    restore the media here                 STORAGE_LOCAL_DIR, ./data/media
//   --no-media       restore the database only
//   --force          overwrite an existing database / write into a non-empty media directory
//   --check          only verify the backup (checksums, integrity, archive), change nothing
//   --help
//
// A restored database is only readable by the application when it runs with the SESSION_SECRET of the
// server that made the backup: sessions, API keys and e-mail links are keyed with it.
//
// Exit codes: 0 done, 1 failed or refused, 2 wrong usage.

import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BackupError,
  checkIntegrity,
  describeDatabase,
  findTar,
  formatBytes,
  listArchive,
  listBackups,
  readManifest,
  runTar,
  sha256File,
} from './backup.mjs';

const DEFAULT_DATABASE = './data/aivore.db';
const DEFAULT_MEDIA = './data/media';

const USAGE = `Usage: node scripts/restore.mjs (--from <backup dir> | --latest) [options]

  --from <dir>     the backup directory to restore
  --latest         the newest complete backup in --out
  --out <dir>      where backups are collected (default: <database directory>/backups)
  --db <path>      restore the database here (default: DATABASE_PATH or ${DEFAULT_DATABASE})
  --media <dir>    restore the media here (default: STORAGE_LOCAL_DIR or ${DEFAULT_MEDIA})
  --no-media       restore the database only
  --force          overwrite an existing database / write into a non-empty media directory
  --check          only verify the backup, change nothing
  --help           show this text

Stop the application before restoring.
`;

function fromEnv(env, name) {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 */
export function parseRestoreArgs(argv, env, cwd) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  const valued = new Set(['from', 'out', 'db', 'media']);
  const switches = new Set(['latest', 'no-media', 'force', 'check', 'help']);
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
  if ((flags.from === undefined) === (flags.latest !== true)) {
    throw new BackupError(`Give exactly one of --from <dir> and --latest\n\n${USAGE}`, 2);
  }
  const at = (value) => resolve(cwd, value);
  const database = at(String(flags.db ?? fromEnv(env, 'DATABASE_PATH') ?? DEFAULT_DATABASE));
  const s3 = fromEnv(env, 'STORAGE_DRIVER') === 's3';
  return {
    help: false,
    from: typeof flags.from === 'string' ? at(flags.from) : null,
    out: at(String(flags.out ?? join(dirname(database), 'backups'))),
    database,
    media:
      flags['no-media'] === true || (s3 && flags.media === undefined)
        ? null
        : at(String(flags.media ?? fromEnv(env, 'STORAGE_LOCAL_DIR') ?? DEFAULT_MEDIA)),
    force: flags.force === true,
    checkOnly: flags.check === true,
  };
}

/** The files SQLite keeps next to a database in WAL mode. */
function sidecars(databasePath) {
  return [`${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`];
}

function isNonEmptyDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory() && readdirSync(path).length > 0;
}

function stamp(date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/**
 * Verifies a backup directory completely. Returns what was found; throws BackupError for anything wrong.
 * @param {string} dir
 * @param {{ withMedia: boolean }} options
 */
export async function verifyBackup(dir, { withMedia }) {
  const manifest = readManifest(dir);
  const dbPath = join(dir, manifest.database.file);
  if (!existsSync(dbPath)) throw new BackupError(`The backup is incomplete: ${dbPath} is missing`);
  if ((await sha256File(dbPath)) !== manifest.database.sha256) {
    throw new BackupError(
      `${dbPath} does not match the checksum in the manifest: the backup is damaged or was changed`,
    );
  }
  const integrity = checkIntegrity(dbPath);
  if (!integrity.ok) {
    throw new BackupError(
      `The backup's database failed its integrity check: ${integrity.messages.slice(0, 3).join('; ')}`,
    );
  }
  let archive = null;
  if (withMedia && manifest.media != null) {
    const archivePath = join(dir, manifest.media.file);
    if (!existsSync(archivePath))
      throw new BackupError(`The backup is incomplete: ${archivePath} is missing`);
    if ((await sha256File(archivePath)) !== manifest.media.sha256) {
      throw new BackupError(
        `${archivePath} does not match the checksum in the manifest: the backup is damaged or was changed`,
      );
    }
    if (!findTar().available) {
      throw new BackupError(
        'Restoring media needs the "tar" program, which is not installed (or use --no-media)',
      );
    }
    const { files } = await listArchive(archivePath);
    archive = { path: archivePath, files };
  }
  return { manifest, dbPath, archive };
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, log?: (line: string) => void, error?: (line: string) => void, now?: Date }} [io]
 */
export async function runRestore(argv, io = {}) {
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const error = io.error ?? ((line) => process.stderr.write(`${line}\n`));
  const now = io.now ?? new Date();
  try {
    const options = parseRestoreArgs(argv, env, io.cwd ?? process.cwd());
    if (options.help) {
      log(USAGE.trimEnd());
      return 0;
    }

    let from = options.from;
    if (from === null) {
      const newest = listBackups(options.out).at(-1);
      if (newest === undefined) throw new BackupError(`No complete backup found in ${options.out}`);
      from = join(options.out, newest);
    }
    log(`Backup: ${from}`);

    // 1. Everything about the backup itself.
    const { manifest, dbPath, archive } = await verifyBackup(from, {
      withMedia: options.media !== null,
    });
    const tableCount = Object.keys(manifest.database.tables ?? {}).length;
    log(
      `  made ${manifest.createdAt}; database ${formatBytes(manifest.database.bytes)}, ${tableCount} tables, checksum and integrity ok`,
    );
    if (options.media !== null && manifest.media == null) log('  this backup has no media archive');
    if (archive) log(`  media archive: ${archive.files} files, checksum ok, paths safe`);
    if (options.checkOnly) {
      log('Check only: nothing was changed.');
      return 0;
    }

    // 2. The target. Every refusal happens before the first change.
    if (resolve(options.database) === resolve(dbPath)) {
      throw new BackupError('The target database is the backup file itself');
    }
    const existing = [options.database, ...sidecars(options.database)].filter((path) =>
      existsSync(path),
    );
    if (existing.length > 0 && !options.force) {
      throw new BackupError(
        `${options.database} already exists. Stop the application, then run again with --force (the old database is kept as ${basename(options.database)}.pre-restore-<time>).`,
      );
    }
    if (archive && options.media !== null && isNonEmptyDirectory(options.media) && !options.force) {
      throw new BackupError(
        `${options.media} is not empty. Run again with --force to extract the backup over it (nothing is deleted).`,
      );
    }

    // 3. The database: copy beside the target, verify, move the old one aside, rename into place.
    mkdirSync(dirname(options.database), { recursive: true });
    const staged = `${options.database}.restoring`;
    rmSync(staged, { force: true });
    copyFileSync(dbPath, staged);
    chmodSync(staged, 0o600);
    if ((await sha256File(staged)) !== manifest.database.sha256) {
      rmSync(staged, { force: true });
      throw new BackupError(
        'The copy of the database does not match the backup (disk problem?); nothing was changed',
      );
    }
    const aside = [];
    if (existing.length > 0) {
      const suffix = `.pre-restore-${stamp(now)}`;
      for (const path of existing) {
        renameSync(path, `${path}${suffix}`);
        aside.push(`${path}${suffix}`);
      }
    }
    renameSync(staged, options.database);
    const after = checkIntegrity(options.database);
    if (!after.ok) {
      throw new BackupError(
        `The restored database failed its integrity check: ${after.messages.slice(0, 3).join('; ')}`,
      );
    }
    const counts = describeDatabase(options.database).tables;
    log(`Database restored to ${options.database}`);
    if (aside.length > 0)
      log(`  previous database kept as ${aside.join(', ')} (delete it when you are sure)`);
    const interesting = ['users', 'generations', 'assets', 'orders'].filter(
      (name) => name in counts,
    );
    if (interesting.length > 0)
      log(`  rows: ${interesting.map((name) => `${name} ${counts[name]}`).join(', ')}`);

    // 4. The media.
    if (archive && options.media !== null) {
      mkdirSync(options.media, { recursive: true });
      const { code, stderr } = await runTar([
        '-xf',
        archive.path,
        '-C',
        options.media,
        '--no-same-owner',
      ]);
      if (code !== 0) {
        throw new BackupError(
          `tar failed while extracting the media into ${options.media}: ${stderr || `exit ${code}`}. The database was already restored.`,
        );
      }
      log(`Media restored to ${options.media} (${archive.files} files)`);
    }

    log(
      'Done. Start the application with the SESSION_SECRET of the server that made this backup, then open /api/health.',
    );
    return 0;
  } catch (failure) {
    if (failure instanceof BackupError) {
      error(`restore: ${failure.message}`);
      return failure.exitCode;
    }
    error(
      `restore: unexpected error: ${failure instanceof Error ? (failure.stack ?? failure.message) : String(failure)}`,
    );
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runRestore(process.argv.slice(2));
}
