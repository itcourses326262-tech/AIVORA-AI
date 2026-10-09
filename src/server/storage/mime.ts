// OWNER: storage
import 'server-only';
import { AppError } from '@/lib/errors';

export const DEFAULT_MIME = 'application/octet-stream';
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
export const MAX_MIME_LENGTH = 127;

export function isValidMimeType(value: string): boolean {
  return value.length <= MAX_MIME_LENGTH && MIME_PATTERN.test(value);
}

/** Refuses anything that is not a plain `type/subtype` (no parameters, no control characters). */
export function assertMimeType(mimeType: string): void {
  if (!isValidMimeType(mimeType)) throw AppError.of('bad_request', 'Invalid mime type');
}
