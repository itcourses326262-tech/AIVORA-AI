// OWNER: storage
import 'server-only';
import { RangeNotSatisfiableError, type StorageRange } from './types';

/**
 * Turns a requested range into inclusive absolute offsets for an object of `size` bytes: an open
 * end runs to the last byte, an end past the object is clamped, a negative `start` is a suffix
 * range. Anything that selects no byte is a {@link RangeNotSatisfiableError}.
 */
export function resolveStorageRange(
  range: StorageRange,
  size: number,
): { start: number; end: number } {
  const unsatisfiable = () => new RangeNotSatisfiableError(size);
  const { start, end } = range;
  if (!Number.isSafeInteger(start) || (end !== undefined && !Number.isSafeInteger(end))) {
    throw unsatisfiable();
  }
  // `-0` is what a "last 0 bytes" suffix looks like; it selects nothing.
  if (Object.is(start, -0)) throw unsatisfiable();
  if (start < 0) {
    if (end !== undefined || size === 0) throw unsatisfiable();
    return { start: Math.max(0, size + start), end: size - 1 };
  }
  if (start >= size) throw unsatisfiable();
  const last = end === undefined ? size - 1 : Math.min(end, size - 1);
  if (last < start) throw unsatisfiable();
  return { start, end: last };
}
