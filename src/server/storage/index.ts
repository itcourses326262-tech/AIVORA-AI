// OWNER: storage — real wiring; keep `getStorage` and `setStorageOverride`
import 'server-only';
import { getEnv } from '@/server/env';
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
  const id = env.STORAGE_DRIVER === 's3' ? 's3' : `local:${env.STORAGE_LOCAL_DIR}`;
  const scope = globalThis as GlobalWithStorage;
  const existing = scope[STORAGE_KEY];
  if (existing?.id === id) return existing.driver;
  const driver =
    env.STORAGE_DRIVER === 's3' ? createS3Storage(env) : createLocalStorage(env.STORAGE_LOCAL_DIR);
  scope[STORAGE_KEY] = { driver, id };
  return driver;
}
