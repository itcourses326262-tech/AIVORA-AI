// OWNER: storage — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { StorageDriver } from './types';

/**
 * Stores objects as files under `rootDir`. Keys are validated against `STORAGE_KEY_PATTERN`, `..`
 * is refused and the resolved path must stay inside `rootDir`.
 */
export function createLocalStorage(_rootDir: string): StorageDriver {
  throw new NotImplementedError('storage.createLocalStorage');
}
