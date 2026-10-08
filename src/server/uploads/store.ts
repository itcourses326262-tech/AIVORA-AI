// OWNER: storage
import 'server-only';
import { createHash } from 'node:crypto';
import type { StorageDriver } from '@/server/storage/types';
import { removeAssetObjects } from './remove';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface ObjectToStore {
  key: string;
  body: Uint8Array | NodeJS.ReadableStream;
  mimeType: string;
}

/**
 * Writes the objects concurrently. If any write fails, the ones that succeeded are removed too,
 * so a failed upload never leaves orphans behind, and the first failure is rethrown.
 */
export async function putObjects(
  storage: StorageDriver,
  objects: readonly ObjectToStore[],
): Promise<void> {
  const results = await Promise.allSettled(
    objects.map((object) => storage.put(object.key, object.body, { mimeType: object.mimeType })),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (!failure) return;
  await removeAssetObjects(
    storage,
    objects.map((object) => ({ storageKey: object.key, thumbKey: null })),
  );
  throw failure.reason;
}
