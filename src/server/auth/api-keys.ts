import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { ApiKeyDTO, CreateApiKeyResponse } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { getDb, withTx, type Db, type DbOrTx } from '@/server/db';
import { apiKeys, users, type ApiKeyRow, type UserRow } from '@/server/db/schema';
import { isEmailVerificationRequired } from './email-policy';
import { generateToken, hashToken } from './tokens';
import { parseLabel } from './validation';

/** A user may hold this many unrevoked keys. */
export const MAX_ACTIVE_API_KEYS = 20;
export const API_KEY_NAME_MAX = 60;
/** `lastUsedAt` is rewritten at most this often per key. */
export const API_KEY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const LIST_LIMIT = 100;
const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const PREFIX_LENGTH = 8;

/** `avk_` + 8 public characters + `_` + 43 secret characters (32 random bytes, base64url). */
const API_KEY_PATTERN = /^avk_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

/** Whether `value` has the shape of an API key (it says nothing about whether it exists). */
export function isApiKeyShape(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

function newPrefix(): string {
  // 256 is not a multiple of 36, so values from the biased tail are redrawn.
  const limit = 256 - (256 % PREFIX_ALPHABET.length);
  let out = '';
  while (out.length < PREFIX_LENGTH) {
    for (const byte of randomBytes(PREFIX_LENGTH * 2)) {
      if (byte < limit && out.length < PREFIX_LENGTH) {
        out += PREFIX_ALPHABET.charAt(byte % PREFIX_ALPHABET.length);
      }
    }
  }
  return out;
}

export function toApiKeyDTO(row: ApiKeyRow): ApiKeyDTO {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt,
    ...(row.lastUsedAt === null ? {} : { lastUsedAt: row.lastUsedAt }),
    ...(row.revokedAt === null ? {} : { revokedAt: row.revokedAt }),
  };
}

/**
 * Creates `avk_<prefix>_<secret>`. The full key is in the result once and never stored: the
 * database keeps only `hashToken(key)` and the public prefix. At most {@link MAX_ACTIVE_API_KEYS}
 * unrevoked keys per user (`conflict` beyond that), counted in the same transaction as the insert.
 *
 * While the deployment requires confirmed email addresses, an unconfirmed account gets
 * `email_not_verified` (403) instead: such an account was opened by whoever typed the address, not
 * necessarily by its owner, and a credential planted now would outlive the owner taking the account
 * over (the reset also revokes every key, but there is no reason to let one be planted at all).
 */
export async function createApiKey(userId: string, name: string): Promise<CreateApiKeyResponse> {
  const cleaned = parseLabel(name, 'name', API_KEY_NAME_MAX);
  const prefix = `avk_${newPrefix()}`;
  const key = `${prefix}_${generateToken()}`;
  const now = Date.now();

  const row = withTx(getDb(), (tx) => {
    const owner = tx
      .select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (owner && owner.emailVerifiedAt === null && isEmailVerificationRequired()) {
      throw AppError.of('email_not_verified', 'Confirm your email first');
    }
    const active = tx
      .select({ total: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .get();
    if ((active?.total ?? 0) >= MAX_ACTIVE_API_KEYS) {
      throw AppError.of(
        'conflict',
        `You can have at most ${MAX_ACTIVE_API_KEYS} active API keys. Revoke one first.`,
      );
    }
    return tx
      .insert(apiKeys)
      .values({
        id: newId('key', now),
        userId,
        name: cleaned,
        prefix,
        keyHash: hashToken(key),
        createdAt: now,
      })
      .returning()
      .get();
  });
  return { key, record: toApiKeyDTO(row) };
}

/**
 * The user's keys, newest first: EVERY active key (at most {@link MAX_ACTIVE_API_KEYS}, so the
 * owner can always see and revoke what is live) plus the most recently created revoked ones, up to
 * {@link LIST_LIMIT} rows in all. Revoked keys are kept for the audit trail but must never push a
 * live key out of the list.
 */
export async function listApiKeys(userId: string): Promise<ApiKeyDTO[]> {
  const db = getDb();
  const active = db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
    .limit(LIST_LIMIT)
    .all();
  const revoked = db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNotNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
    .limit(Math.max(0, LIST_LIMIT - active.length))
    .all();
  return [...active, ...revoked]
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map(toApiKeyDTO);
}

/**
 * Marks the key revoked. `not_found` when it does not exist or belongs to someone else (the two
 * look the same on purpose). Revoking a revoked key succeeds and changes nothing.
 */
export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  const db = getDb();
  const revoked = db
    .update(apiKeys)
    .set({ revokedAt: Date.now() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id })
    .get();
  if (revoked) return;
  const existing = db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .get();
  if (!existing) throw AppError.of('not_found', 'API key not found');
}

/**
 * Revokes every live key of the user and returns how many there were. Keys revoked earlier keep
 * their original date. Synchronous, so a recovery flow can do it in the transaction that changes
 * the password.
 */
export function revokeAllApiKeys(db: DbOrTx, userId: string, now: number = Date.now()): number {
  return db
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id })
    .all().length;
}

export interface ResolvedApiKey {
  keyId: string;
  user: UserRow;
}

/**
 * The key's owner when `presented` is a live key of an enabled account, otherwise null. The key
 * is looked up by `hashToken(presented)` (an HMAC under the server secret), so there is no secret
 * comparison left to time. `lastUsedAt` is refreshed at most every {@link API_KEY_TOUCH_INTERVAL_MS}.
 */
export function resolveApiKey(
  presented: string,
  db: Db = getDb(),
  now: number = Date.now(),
): ResolvedApiKey | null {
  if (!API_KEY_PATTERN.test(presented)) return null;
  const row = db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.keyHash, hashToken(presented)))
    .get();
  if (!row || row.key.revokedAt !== null || row.user.disabledAt !== null) return null;

  const { key } = row;
  if (key.lastUsedAt === null || now - key.lastUsedAt >= API_KEY_TOUCH_INTERVAL_MS) {
    db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, key.id)).run();
  }
  return { keyId: key.id, user: row.user };
}
