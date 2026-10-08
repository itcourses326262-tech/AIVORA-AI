/**
 * Prefixed, time-sortable identifiers: `gen_<26 chars>`.
 *
 * The 26 characters are a ULID: 48 bits of millisecond timestamp (10 chars) followed by 80 bits of
 * randomness (16 chars), encoded in lowercase Crockford base32. Lowercase keeps ids valid inside
 * storage keys (`/^[a-z0-9/_\-.]+$/`). Lexicographic order equals creation order, which makes ids
 * usable as keyset-pagination cursors. Only `crypto.getRandomValues` is needed, so this runs in
 * browsers and Node alike.
 */

export const ID_PREFIXES = ['usr', 'ses', 'key', 'gen', 'ast', 'led'] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];
export type Id<P extends IdPrefix = IdPrefix> = `${P}_${string}`;

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const BODY_LENGTH = TIME_CHARS + RANDOM_CHARS;
const MAX_TIME = 2 ** 48 - 1;
const BODY_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/;

// Within one millisecond the random part is incremented instead of redrawn, so ids created by
// this process are strictly increasing even when the clock stalls or steps backwards.
let lastTime = -1;
let lastRandom: number[] = [];

function freshRandomDigits(): number[] {
  const bytes = new Uint8Array(RANDOM_CHARS);
  globalThis.crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so masking keeps the distribution uniform.
  return Array.from(bytes, (byte) => byte & 31);
}

/** Adds one to a base32 digit array in place; returns false on overflow. */
function increment(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i--) {
    const digit = digits[i] as number;
    if (digit < 31) {
      digits[i] = digit + 1;
      return true;
    }
    digits[i] = 0;
  }
  return false;
}

function encodeTime(time: number): string {
  let rest = time;
  let out = '';
  for (let i = 0; i < TIME_CHARS; i++) {
    out = ALPHABET.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function isPrefix(value: string): value is IdPrefix {
  return (ID_PREFIXES as readonly string[]).includes(value);
}

/**
 * Creates a new id such as `gen_01hxyz…`. `now` exists for deterministic tests.
 * @throws TypeError when `prefix` is not one of {@link ID_PREFIXES}.
 */
export function newId<P extends IdPrefix>(prefix: P, now: number = Date.now()): Id<P> {
  if (!isPrefix(prefix)) {
    throw new TypeError(`Unknown id prefix "${String(prefix)}"`);
  }
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIME) {
    throw new RangeError(`Timestamp out of range for an id: ${now}`);
  }

  let time = Math.max(now, lastTime);
  if (time === lastTime && lastRandom.length === RANDOM_CHARS) {
    if (!increment(lastRandom)) {
      // 2^80 ids in one millisecond: borrow the next millisecond rather than wrap around.
      time += 1;
      lastRandom = freshRandomDigits();
    }
  } else {
    lastRandom = freshRandomDigits();
  }
  lastTime = time;

  let body = encodeTime(time);
  for (const digit of lastRandom) body += ALPHABET.charAt(digit);
  return `${prefix}_${body}` as Id<P>;
}

/** True when `value` is a well-formed id, optionally of the given prefix. */
export function isValidId<P extends IdPrefix>(value: unknown, prefix?: P): value is Id<P> {
  if (typeof value !== 'string') return false;
  const separator = value.indexOf('_');
  if (separator < 0) return false;
  const actualPrefix = value.slice(0, separator);
  if (!isPrefix(actualPrefix)) return false;
  if (prefix !== undefined && actualPrefix !== prefix) return false;
  const body = value.slice(separator + 1);
  return body.length === BODY_LENGTH && BODY_PATTERN.test(body);
}

/** Creation time (ms since epoch) embedded in an id, or null if the id is malformed. */
export function idTimestamp(id: string): number | null {
  if (!isValidId(id)) return null;
  const body = id.slice(id.indexOf('_') + 1, id.indexOf('_') + 1 + TIME_CHARS);
  let time = 0;
  for (const char of body) time = time * 32 + ALPHABET.indexOf(char);
  return time;
}
