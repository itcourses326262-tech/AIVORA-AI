// OWNER: storage — contract types (real). Extend additively only.
import 'server-only';
import { AppError } from '@/lib/errors';

/** Keys are lowercase path-like strings; drivers must reject anything else (no `..`, no leading `/`). */
export const STORAGE_KEY_PATTERN = /^[a-z0-9/_\-.]+$/;

export interface StoredObjectInfo {
  size: number;
  mimeType: string;
}

export interface StorageRange {
  /**
   * First byte, or a negative number for a suffix range: `-500` is the last 500 bytes
   * (`bytes=-500`). A suffix range has no `end`.
   */
  start: number;
  /** Inclusive. Open-ended (`bytes=100-`) when omitted. */
  end?: number;
}

export interface StorageReadResult {
  stream: ReadableStream<Uint8Array>;
  /** Total size of the object, not of the returned range. */
  size: number;
  mimeType: string;
  /** The inclusive byte range actually returned; present only for ranged reads. */
  range?: { start: number; end: number };
}

export interface StorageDriver {
  put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    opts: { mimeType: string },
  ): Promise<{ bytes: number }>;
  /** `not_found` AppError when the object does not exist. */
  get(key: string, range?: StorageRange): Promise<StorageReadResult>;
  /** Null when the object does not exist. */
  head(key: string): Promise<StoredObjectInfo | null>;
  /** Idempotent: deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  /** A short-lived direct URL, or null when the driver cannot offer one (local disk). */
  signedUrl?(key: string, ttlSec: number): Promise<string | null>;
}

/**
 * A byte range that cannot be served for an object of `size` bytes. HTTP callers answer 416 and
 * report `size` in the `Content-Range` header; the status is part of the error so it also maps
 * correctly when it reaches the generic error envelope.
 */
export class RangeNotSatisfiableError extends AppError {
  override readonly name: string = 'RangeNotSatisfiableError';

  constructor(readonly size: number) {
    super('bad_request', 416, 'Requested range not satisfiable', { size });
  }
}

export function isRangeNotSatisfiable(value: unknown): value is RangeNotSatisfiableError {
  return value instanceof RangeNotSatisfiableError;
}
