// OWNER: storage
import 'server-only';
import { AppError } from '@/lib/errors';
import { STORAGE_KEY_PATTERN } from './types';

export const MAX_STORAGE_KEY_LENGTH = 512;
const MAX_SEGMENT_LENGTH = 200;

/**
 * Stricter than `STORAGE_KEY_PATTERN` alone: no empty, `.`/`..` or dot-leading segments (those are
 * reserved for the local driver's temp and sidecar files), and bounded lengths. Every driver
 * checks this before touching disk or the network.
 */
export function isValidStorageKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_STORAGE_KEY_LENGTH) {
    return false;
  }
  if (!STORAGE_KEY_PATTERN.test(key)) return false;
  return key
    .split('/')
    .every(
      (segment) =>
        segment.length > 0 && segment.length <= MAX_SEGMENT_LENGTH && !segment.startsWith('.'),
    );
}

/** `bad_request` for anything `isValidStorageKey` refuses. The offending key is not echoed. */
export function assertStorageKey(key: unknown): asserts key is string {
  if (!isValidStorageKey(key)) throw AppError.of('bad_request', 'Invalid storage key');
}
