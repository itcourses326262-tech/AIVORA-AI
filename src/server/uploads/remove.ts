// OWNER: storage
import 'server-only';
import { getLogger } from '@/server/logger';
import { getStorage } from '@/server/storage';
import type { StorageDriver } from '@/server/storage/types';
import type { AssetRow } from '@/server/db/schema';

type StoredAsset = Pick<AssetRow, 'storageKey' | 'thumbKey'>;

const BATCH_SIZE = 16;

/** Best-effort removal of the stored files of deleted assets; failures are logged, not thrown. */
export async function removeAssetObjects(
  storage: StorageDriver,
  assets: ReadonlyArray<StoredAsset>,
): Promise<void> {
  const keys = assets.flatMap((asset) =>
    asset.thumbKey ? [asset.storageKey, asset.thumbKey] : [asset.storageKey],
  );
  for (let start = 0; start < keys.length; start += BATCH_SIZE) {
    const batch = keys.slice(start, start + BATCH_SIZE);
    await Promise.all(
      batch.map(async (key) => {
        try {
          await storage.delete(key);
        } catch (err) {
          getLogger().warn('Could not delete a stored object', { key, err });
        }
      }),
    );
  }
}

/** {@link removeAssetObjects} on the configured storage, for callers that do not hold a driver. */
export async function deleteAssetObjects(assets: ReadonlyArray<StoredAsset>): Promise<void> {
  await removeAssetObjects(getStorage(), assets);
}
