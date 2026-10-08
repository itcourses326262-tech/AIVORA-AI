import { isRangeNotSatisfiable, type StorageRange } from '@/server/storage/types';
import { resolveStorageRange } from '@/server/storage/range';

export type RangeDecision =
  { kind: 'full' } | { kind: 'partial'; start: number; end: number } | { kind: 'unsatisfiable' };

const FULL: RangeDecision = { kind: 'full' };
const SINGLE_RANGE = /^(\d*)-(\d*)$/;
// Anything this long is far beyond any file; saturating avoids float rounding in Number().
const MAX_DIGITS = 15;

const toNumber = (digits: string) =>
  digits.length > MAX_DIGITS ? Number.MAX_SAFE_INTEGER : Number(digits);

/** `bytes=...` -> a storage range, `null` when the header must be ignored. */
function parseRange(header: string): StorageRange | 'unsatisfiable' | null {
  const separator = header.indexOf('=');
  if (separator < 0 || header.slice(0, separator).trim().toLowerCase() !== 'bytes') return null;
  const spec = header.slice(separator + 1).trim();
  // Several ranges would need a multipart response; ignoring the header is allowed (RFC 9110).
  const match = SINGLE_RANGE.exec(spec);
  if (!match) return null;
  const [, first = '', last = ''] = match;
  if (first === '') {
    if (last === '') return null;
    const length = toNumber(last);
    return length === 0 ? 'unsatisfiable' : { start: -length };
  }
  const start = toNumber(first);
  if (last === '') return { start };
  const end = toNumber(last);
  // "last < first" is a malformed range, which is ignored rather than answered with 416.
  return end < start ? null : { start, end };
}

/** `If-Range` only matches a strong ETag equal to ours; dates never match (we send no Last-Modified). */
function ifRangeMatches(ifRange: string | null, etag: string): boolean {
  if (ifRange === null) return true;
  return ifRange.trim() === etag;
}

/**
 * How to answer a `Range` header for an object of `size` bytes (RFC 9110, section 14): a single
 * satisfiable range is `partial`; an unsatisfiable one is `unsatisfiable` (416); a missing,
 * malformed, multi-range, non-`bytes` or stale (`If-Range`) header is ignored and the whole object
 * is served.
 */
export function decideRange(
  header: string | null,
  size: number,
  precondition: { ifRange: string | null; etag: string },
): RangeDecision {
  if (header === null || header.trim() === '') return FULL;
  if (!ifRangeMatches(precondition.ifRange, precondition.etag)) return FULL;
  const parsed = parseRange(header);
  if (parsed === null) return FULL;
  if (parsed === 'unsatisfiable') return { kind: 'unsatisfiable' };
  try {
    return { kind: 'partial', ...resolveStorageRange(parsed, size) };
  } catch (error) {
    if (isRangeNotSatisfiable(error)) return { kind: 'unsatisfiable' };
    throw error;
  }
}
