// OWNER: storage — real wiring; keep `getStorage` and `setStorageOverride`
import 'server-only';
import { getEnv, type Env } from '@/server/env';
import { createGcsStorage } from './gcs';
import { createLocalStorage } from './local';
import { createS3Storage } from './s3';
import type { StorageDriver } from './types';

export * from './types';

const STORAGE_KEY = Symbol.for('aivore.storage');
type GlobalWithStorage = typeof globalThis & {
  [STORAGE_KEY]?: { driver: StorageDriver; id: string };
};

let override: StorageDriver | null = null;

/** Tests inject an in-memory driver here; `null` restores the configured one. */
export function setStorageOverride(driver: StorageDriver | null): void {
  override = driver;
}

/**
 * The process-wide driver chosen by `STORAGE_DRIVER`, created on first use (never at import time)
 * and kept on `globalThis` so Next.js dev HMR does not recreate it.
 */
export function getStorage(): StorageDriver {
  if (override) return override;
  const env = getEnv();
  const id = driverId(env);
  const scope = globalThis as GlobalWithStorage;
  const existing = scope[STORAGE_KEY];
  if (existing?.id === id) return existing.driver;
  const driver = createDriver(env);
  scope[STORAGE_KEY] = { driver, id };
  return driver;
}

/**
 * Why the configured driver cannot be created, as one line that names the setting; null when it
 * can. Creating the gcs driver reads and checks the service-account key, so a missing, unreadable or
 * malformed key shows up here (at start-up, see `instrumentation.ts`, and in `/api/health`) and not
 * at the first upload, after the site has already accepted and billed generations nothing can run.
 * The text never holds the path or any part of the key (see `ServiceAccountError`). An invalid
 * environment is not reported here: `getEnv()` throws its own error for that.
 */
export function storageProblem(): string | null {
  try {
    getStorage();
    return null;
  } catch (error) {
    // An invalid environment is not a storage problem: getEnv() throws its own error again here.
    const driver = getEnv().STORAGE_DRIVER;
    const reason = error instanceof Error ? error.message : String(error);
    return `Storage is not usable (STORAGE_DRIVER=${driver}): ${reason.replace(/\s+/g, ' ').slice(0, 300)}`;
  }
}

function driverId(env: Env): string {
  if (env.STORAGE_DRIVER === 's3') return 's3';
  if (env.STORAGE_DRIVER === 'gcs') return `gcs:${env.FIREBASE_STORAGE_BUCKET}`;
  return `local:${env.STORAGE_LOCAL_DIR}`;
}

function createDriver(env: Env): StorageDriver {
  if (env.STORAGE_DRIVER === 's3') return createS3Storage(env);
  if (env.STORAGE_DRIVER === 'gcs') return createGcsStorage(env);
  return createLocalStorage(env.STORAGE_LOCAL_DIR);
}
