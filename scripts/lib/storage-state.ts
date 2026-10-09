// Where the site keeps its pictures and videos TODAY, read the way the site reads its env files, and
// whether switching to another place would leave something behind. Used by `setup:firebase`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readEnvValue } from './env-file';

export interface StorageSettings {
  /** `local` when nothing sets it. */
  driver: string;
  /** Base name of the env file that set STORAGE_DRIVER, or null for the default. */
  driverFrom: string | null;
  /** Absolute. */
  mediaDir: string;
  /** Absolute. */
  databasePath: string;
}

/**
 * STORAGE_DRIVER, STORAGE_LOCAL_DIR and DATABASE_PATH from the env files in load order (`.env`,
 * then `.env.local`: the last file that sets a name wins, and inside a file the last line), then
 * from the shell as a fallback, then the defaults. The shell comes last on purpose: a variable
 * exported for one command (`STORAGE_DRIVER=gcs npm run check:storage` stays in a PowerShell session)
 * says nothing about what the site was configured with.
 */
export function readStorageSettings(options: {
  cwd: string;
  /** Env files, in load order; missing files are skipped. */
  files: string[];
  env?: Readonly<Record<string, string | undefined>>;
}): StorageSettings {
  const env = options.env ?? process.env;
  const texts = options.files.flatMap((file) =>
    existsSync(file) ? [{ file, text: readFileSync(file, 'utf8') }] : [],
  );
  function lookup(name: string): { value: string | undefined; from: string | null } {
    let found: { value: string | undefined; from: string | null } = {
      value: undefined,
      from: null,
    };
    for (const { file, text } of texts) {
      const value = readEnvValue(text, name);
      if (value !== undefined) found = { value, from: path.basename(file) };
    }
    if (found.value !== undefined) return found;
    const fromShell = env[name]?.trim();
    return { value: fromShell || undefined, from: null };
  }
  const driver = lookup('STORAGE_DRIVER');
  return {
    driver: driver.value ?? 'local',
    driverFrom: driver.from,
    mediaDir: path.resolve(options.cwd, lookup('STORAGE_LOCAL_DIR').value ?? './data/media'),
    databasePath: path.resolve(options.cwd, lookup('DATABASE_PATH').value ?? './data/aivore.db'),
  };
}

/**
 * Rows of the `assets` table: every picture and video the database knows. 0 when there is no
 * database or no table yet; null when the database exists but cannot be read (locked, damaged), so
 * the caller does not mistake "unknown" for "none".
 */
export function countAssetRows(databasePath: string): number | null {
  if (!existsSync(databasePath)) return 0;
  let db: Database.Database;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
  try {
    const row = db.prepare('select count(*) as n from assets').get() as { n: number };
    return row.n;
  } catch (error) {
    return error instanceof Error && /no such table/i.test(error.message) ? 0 : null;
  } finally {
    db.close();
  }
}

export interface MediaSituation {
  driver: string;
  /** Files under STORAGE_LOCAL_DIR (see `hasLocalMedia`). */
  files: boolean;
  /** `countAssetRows`. */
  assetRows: number | null;
}

/**
 * Why the site must NOT be switched to the bucket automatically, in words; null when it may.
 * Anything that is not an empty local site needs a human: files that were never copied would be
 * 404 after the switch, and files in S3 are not something this tool can move.
 */
export function switchBlocker(situation: MediaSituation): string | null {
  if (situation.driver === 's3') {
    return 'the site stores its media in S3 today, and nothing here copies files out of S3';
  }
  if (situation.driver !== 'local') {
    return `STORAGE_DRIVER is "${situation.driver}", which this tool does not know how to leave`;
  }
  if (situation.files) {
    return 'pictures and videos are already stored on this computer; copy them first (npm run migrate:media)';
  }
  if (situation.assetRows === null) {
    return 'the database could not be read, so it is not known whether pictures are stored';
  }
  if (situation.assetRows > 0) {
    return `the database lists ${String(situation.assetRows)} stored pictures and videos; copy them first (npm run migrate:media)`;
  }
  return null;
}
