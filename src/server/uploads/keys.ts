// OWNER: storage
import 'server-only';
import { AppError } from '@/lib/errors';

const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;

/** Folder used for user uploads, which belong to no generation. */
export const UPLOADS_FOLDER = 'uploads';

export interface ObjectKeys {
  /** `u/<userId>/<generationId|uploads>/<assetId>.<ext>` */
  storageKey: string;
  /** `u/<userId>/<generationId|uploads>/<assetId>.thumb.webp` */
  thumbKey: string;
}

function segment(value: string, what: string): string {
  if (!SEGMENT_PATTERN.test(value))
    throw AppError.of('bad_request', `Invalid ${what} for a storage key`);
  return value;
}

/**
 * The layout of section 6.5. Every part is validated, so ids can never smuggle a `/`, a `..` or
 * an uppercase letter into a key. Asset ids carry 80 random bits, so keys cannot be guessed (and
 * are never shown to clients anyway: they only see `/api/v1/media/:assetId`).
 */
export function objectKeys(parts: {
  userId: string;
  /** A generation id, or {@link UPLOADS_FOLDER}. */
  folder: string;
  assetId: string;
  extension: string;
}): ObjectKeys {
  if (!EXTENSION_PATTERN.test(parts.extension)) {
    throw AppError.of('bad_request', 'Invalid extension for a storage key');
  }
  const stem = `u/${segment(parts.userId, 'user id')}/${segment(parts.folder, 'folder')}/${segment(parts.assetId, 'asset id')}`;
  return { storageKey: `${stem}.${parts.extension}`, thumbKey: `${stem}.thumb.webp` };
}
