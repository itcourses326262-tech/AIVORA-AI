// OWNER: storage
import 'server-only';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { getDb } from '@/server/db';
import { assets } from '@/server/db/schema';
import { getEnv } from '@/server/env';
import { getStorage } from '@/server/storage';
import { makeThumbnail, normalizeUpload } from './image';
import { objectKeys, UPLOADS_FOLDER } from './keys';
import { removeAssetObjects } from './remove';
import { extensionForMime } from './sniff';
import { putObjects, sha256Hex } from './store';
import type { AssetRecord } from './types';

const BYTES_PER_MB = 1024 * 1024;

/** Reads the file in chunks and gives up as soon as it is over the limit, whatever `size` claims. */
async function readBounded(file: File, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () =>
    AppError.of('payload_too_large', `Uploads are limited to ${maxBytes / BYTES_PER_MB} MB`);
  if (file.size > maxBytes) throw tooLarge();
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

/**
 * Validates and stores an uploaded input image for `userId`: size limit (`MAX_UPLOAD_MB`),
 * magic-byte sniffing (PNG/JPEG/WebP only), sharp decode with a pixel limit, EXIF stripped, scaled
 * to at most 4096 px, thumbnail, and an `assets` row with role `input`.
 *
 * Only the re-encoded pixels are stored. The claimed content type and file name are never used.
 */
export async function acceptUpload(file: File, userId: string): Promise<AssetRecord> {
  const raw = await readBounded(file, getEnv().MAX_UPLOAD_MB * BYTES_PER_MB);
  if (raw.byteLength === 0) throw AppError.of('bad_request', 'The uploaded file is empty');

  const image = await normalizeUpload(raw);
  const thumb = await makeThumbnail(image.bytes);

  const assetId = newId('ast');
  const keys = objectKeys({
    userId,
    folder: UPLOADS_FOLDER,
    assetId,
    extension: extensionForMime(image.mimeType),
  });
  const storage = getStorage();
  await putObjects(storage, [
    { key: keys.storageKey, body: image.bytes, mimeType: image.mimeType },
    { key: keys.thumbKey, body: thumb.bytes, mimeType: 'image/webp' },
  ]);

  try {
    return getDb()
      .insert(assets)
      .values({
        id: assetId,
        userId,
        generationId: null,
        role: 'input',
        kind: 'image',
        index: 0,
        storageKey: keys.storageKey,
        thumbKey: keys.thumbKey,
        mimeType: image.mimeType,
        bytes: image.bytes.byteLength,
        width: image.width,
        height: image.height,
        sha256: sha256Hex(image.bytes),
        createdAt: Date.now(),
      })
      .returning()
      .get();
  } catch (error) {
    await removeAssetObjects(storage, [keys]);
    throw error;
  }
}
