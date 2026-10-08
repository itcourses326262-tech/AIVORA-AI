// OWNER: storage — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';

/** The only image types accepted for upload. */
export const UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

/**
 * Detects the real type from the magic bytes, ignoring the file name and the claimed content type.
 * Null for anything that is not PNG, JPEG or WebP.
 */
export function sniffImageType(_bytes: Uint8Array): UploadMimeType | null {
  throw new NotImplementedError('uploads.sniffImageType');
}

/** File extension without the dot for a stored mime type, e.g. `image/jpeg` -> `jpg`. */
export function extensionForMime(_mimeType: string): string {
  throw new NotImplementedError('uploads.extensionForMime');
}
