// OWNER: storage — replace this stub
import 'server-only';
import type { Kind } from '@/lib/catalog/types';
import { NotImplementedError } from '@/lib/errors';
import type { AssetRow } from '@/server/db/schema';
import type { StorageDriver } from '@/server/storage/types';

/** A row of the `assets` table. */
export type AssetRecord = AssetRow;

export interface PersistOutputInput {
  userId: string;
  generationId: string;
  /** Position among the generation's outputs. */
  index: number;
  kind: Kind;
  bytes: Uint8Array;
  mimeType: string;
  /** For videos; images are probed with sharp instead. */
  durationMs?: number;
  /** Provider-reported size, used for videos (images are probed). */
  width?: number;
  height?: number;
}

/**
 * An output already written to storage, ready to become an `assets` row. `completeGeneration`
 * inserts the rows in the same transaction that marks the generation succeeded, so storing an
 * output never creates a row on its own.
 */
export interface PersistedOutput {
  /** `ast_…`, also the file name in the storage key. */
  assetId: string;
  index: number;
  kind: Kind;
  storageKey: string;
  thumbKey?: string;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  sha256?: string;
}

/**
 * Validates and stores an uploaded input image for `userId`: size limit (`MAX_UPLOAD_MB`),
 * magic-byte sniffing (PNG/JPEG/WebP only), sharp decode with a pixel limit, EXIF stripped, scaled
 * to at most 4096 px, thumbnail, and an `assets` row with role `input`.
 */
export async function acceptUpload(_file: File, _userId: string): Promise<AssetRecord> {
  throw new NotImplementedError('uploads.acceptUpload');
}

/**
 * Writes a generated output (and, for images, its thumbnail) to `storage` under
 * `u/<userId>/<generationId>/<assetId>.<ext>` and returns what the asset row needs.
 */
export async function persistOutput(
  _storage: StorageDriver,
  _input: PersistOutputInput,
): Promise<PersistedOutput> {
  throw new NotImplementedError('uploads.persistOutput');
}

/** Best-effort removal of the stored files of deleted assets; failures are logged, not thrown. */
export async function removeAssetObjects(
  _storage: StorageDriver,
  _assets: ReadonlyArray<Pick<AssetRow, 'storageKey' | 'thumbKey'>>,
): Promise<void> {
  throw new NotImplementedError('uploads.removeAssetObjects');
}
