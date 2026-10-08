import 'server-only';
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { AppError } from '@/lib/errors';
import { COMMON_PASSWORDS } from './common-passwords';
import { fieldError } from './validation';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Cost of new hashes. scrypt needs 128 * N * r bytes (32 MiB here) and about 190 ms of one
 * libuv thread. It is stored inside every hash, so the cost can be raised later:
 * {@link needsRehash} flags the old ones and login upgrades them.
 */
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 2, keyLength: 64, saltLength: 16 } as const;

/** Bounds for the parameters read back from a stored hash, so a damaged row cannot exhaust memory. */
const MIN_N = 2 ** 14;
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;
const MAX_KEY_LENGTH = 128;
const MIN_SALT_BYTES = 8;

/** Passwords longer than this are rejected before any hashing, whatever the policy says. */
const HARD_INPUT_LIMIT = 1024;

const FORMAT = 'scrypt';

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(encoded: string): ParsedHash | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT) return null;
  const [, n, r, p, salt, hash] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  const valid =
    Number.isInteger(N) &&
    (N & (N - 1)) === 0 &&
    N >= MIN_N &&
    N <= MAX_N &&
    Number.isInteger(R) &&
    R >= 1 &&
    R <= MAX_R &&
    Number.isInteger(P) &&
    P >= 1 &&
    P <= MAX_P;
  if (!valid || salt === undefined || hash === undefined) return null;
  const saltBytes = Buffer.from(salt, 'base64url');
  const hashBytes = Buffer.from(hash, 'base64url');
  if (saltBytes.length < MIN_SALT_BYTES) return null;
  if (hashBytes.length < 16 || hashBytes.length > MAX_KEY_LENGTH) return null;
  return { N, r: R, p: P, salt: saltBytes, hash: hashBytes };
}

// ---- Concurrency gate -----------------------------------------------------------------------

/**
 * scrypt runs on libuv's thread pool (4 threads by default), which also serves file system calls.
 * A burst of logins must not starve them, so at most this many hashes run at once; the rest wait.
 */
const MAX_CONCURRENT_HASHES = 3;
const MAX_QUEUED_HASHES = 64;

let running = 0;
const waiting: Array<() => void> = [];

async function withHashSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_HASHES) {
    if (waiting.length >= MAX_QUEUED_HASHES) {
      throw AppError.of('rate_limited', 'Server is busy, try again shortly', { retryAfterSec: 2 });
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await task();
  } finally {
    // The slot passes straight to the next waiter, so `running` stays accurate.
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  const scryptOptions: ScryptOptions = {
    ...options,
    // OpenSSL needs more than 128 * r * (N + p + 2) bytes; double it for headroom.
    maxmem: 2 * 128 * options.r * (options.N + options.p + 2),
  };
  return withHashSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        // NFKC makes visually identical input (Arabic presentation forms, full-width Latin) hash alike.
        scrypt(password.normalize('NFKC'), salt, keyLength, scryptOptions, (error, key) =>
          error ? reject(error) : resolve(key),
        );
      }),
  );
}

// ---- Public API ------------------------------------------------------------------------------

/** scrypt hash in a self-describing string: `scrypt$N$r$p$salt$hash` (salt and hash base64url). */
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, keyLength, saltLength } = SCRYPT_PARAMS;
  const salt = randomBytes(saltLength);
  const key = await deriveKey(password, salt, keyLength, { N, r, p });
  return [FORMAT, N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Constant-time comparison against a {@link hashPassword} result. False for malformed hashes. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > HARD_INPUT_LIMIT) return false;
  const parsed = parseHash(hash);
  if (!parsed) return false;
  const key = await deriveKey(password, parsed.salt, parsed.hash.length, parsed);
  return timingSafeEqual(key, parsed.hash);
}

/** True when the hash is malformed or was made with weaker parameters than {@link SCRYPT_PARAMS}. */
export function needsRehash(hash: string): boolean {
  const parsed = parseHash(hash);
  if (!parsed) return true;
  return (
    parsed.N < SCRYPT_PARAMS.N ||
    parsed.r < SCRYPT_PARAMS.r ||
    parsed.p < SCRYPT_PARAMS.p ||
    parsed.hash.length < SCRYPT_PARAMS.keyLength
  );
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the time of a real verification without knowing the user. Login calls it for unknown
 * emails so that "no such account" and "wrong password" take equally long. The hash is made once
 * per process from random input nobody knows, with the current parameters.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(password, await dummyHash);
}

export interface PasswordContext {
  /** Rejects passwords equal to the account's own email or its local part. */
  email?: string;
}

/**
 * Password policy: 8-128 characters and not in the built-in list of common passwords (or one
 * repeated character, or the account's own email). Throws `validation_failed` (details: one
 * issue at path `password`) when it is not met.
 */
export function assertPasswordPolicy(password: string, context: PasswordContext = {}): void {
  const problem = passwordProblem(password, context);
  if (problem === null) return;
  throw fieldError('password', problem);
}

function passwordProblem(password: string, context: PasswordContext): string | null {
  if (typeof password !== 'string') return 'Password is required';
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  const lowered = password.normalize('NFKC').toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) return 'Password is too common';
  if (new Set(lowered).size === 1) return 'Password is too simple';
  const email = context.email?.trim().toLowerCase();
  if (email && (lowered === email || lowered === email.split('@')[0])) {
    return 'Password must not be your email address';
  }
  return null;
}
