import 'server-only';
import { and, desc, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import type { DbOrTx, Tx } from '@/server/db';
import { emailTokens, type EmailTokenRow, type EmailTokenType } from '@/server/db/schema';
import { generateToken, hashToken } from './tokens';

const HOUR_MS = 60 * 60 * 1000;

/** The confirmation link works for a day, the reset link for an hour. */
export const TOKEN_TTL_MS: Readonly<Record<EmailTokenType, number>> = {
  verify: 24 * HOUR_MS,
  reset: HOUR_MS,
};

/** Links a user may hold at once per kind; asking again beyond it retires the oldest. */
export const MAX_OUTSTANDING_TOKENS = 5;
/** Used and expired rows are kept this long (for support questions), then purged. */
const RETENTION_MS = 7 * 24 * HOUR_MS;
const PURGE_INTERVAL_MS = HOUR_MS;

/** Link secrets are `generateToken()` output: 32 random bytes, base64url. */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * What the database stores: a keyed hash of the secret, domain-separated by kind so a value that
 * is valid for one purpose can never be replayed for another (or confused with a session token).
 */
export function hashEmailToken(type: EmailTokenType, secret: string): string {
  return hashToken(`email-token:${type}:${secret}`);
}

export interface IssuedEmailToken {
  id: string;
  /** Goes into the emailed link and nowhere else; only its hash is stored. */
  secret: string;
  expiresAt: number;
}

let lastPurgeAt = 0;

/** Creates a link secret for the user. Synchronous, so it can join a transaction. */
export function issueEmailToken(
  db: DbOrTx,
  userId: string,
  type: EmailTokenType,
  now: number = Date.now(),
): IssuedEmailToken {
  const secret = generateToken();
  const id = newId('etk', now);
  const expiresAt = now + TOKEN_TTL_MS[type];
  db.insert(emailTokens)
    .values({
      id,
      userId,
      type,
      tokenHash: hashEmailToken(type, secret),
      expiresAt,
      createdAt: now,
    })
    .run();

  // Cap the live ones: the newest MAX_OUTSTANDING_TOKENS stay valid, older unused ones are retired.
  const live = db
    .select({ id: emailTokens.id })
    .from(emailTokens)
    .where(
      and(eq(emailTokens.userId, userId), eq(emailTokens.type, type), isNull(emailTokens.usedAt)),
    )
    .orderBy(desc(emailTokens.createdAt), desc(emailTokens.id))
    .all();
  const excess = live.slice(MAX_OUTSTANDING_TOKENS).map((row) => row.id);
  if (excess.length > 0) {
    db.update(emailTokens).set({ usedAt: now }).where(inArray(emailTokens.id, excess)).run();
  }
  purgeOldTokens(db, now);
  return { id, secret, expiresAt };
}

function purgeOldTokens(db: DbOrTx, now: number): void {
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  db.delete(emailTokens)
    .where(
      or(lt(emailTokens.expiresAt, now - RETENTION_MS), lt(emailTokens.usedAt, now - RETENTION_MS)),
    )
    .run();
}

export type EmailTokenFailure = 'invalid' | 'expired' | 'used';

/**
 * A link that cannot be used. 400 `bad_request` with `details.reason`; the page words each reason
 * differently. Telling "expired" and "used" apart reveals nothing to a guesser: both need the real
 * 256-bit secret.
 */
export class EmailTokenError extends AppError {
  override readonly name: string = 'EmailTokenError';

  constructor(readonly reason: EmailTokenFailure) {
    super('bad_request', 400, 'This link is invalid, expired or was already used', { reason });
  }
}

/** The row behind a secret, without using it. Undefined for anything that is not a live-looking secret. */
export function findEmailToken(
  db: DbOrTx,
  type: EmailTokenType,
  secret: string,
): EmailTokenRow | undefined {
  if (typeof secret !== 'string' || !SECRET_SHAPE.test(secret)) return undefined;
  return db
    .select()
    .from(emailTokens)
    .where(and(eq(emailTokens.tokenHash, hashEmailToken(type, secret)), eq(emailTokens.type, type)))
    .get();
}

/**
 * Single use by compare-and-set: the row flips from unused to used only if it is still unused and
 * unexpired at this very statement, so two simultaneous requests with one link cannot both win.
 * Throws {@link EmailTokenError} otherwise. Call it inside the transaction that acts on the link:
 * if that fails, the link is not burned.
 */
export function consumeEmailToken(
  tx: Tx,
  type: EmailTokenType,
  secret: string,
  now: number = Date.now(),
): EmailTokenRow {
  const row = findEmailToken(tx, type, secret);
  if (!row) throw new EmailTokenError('invalid');
  if (row.usedAt !== null) throw new EmailTokenError('used');
  if (row.expiresAt <= now) throw new EmailTokenError('expired');
  const claimed = tx
    .update(emailTokens)
    .set({ usedAt: now })
    .where(and(eq(emailTokens.id, row.id), isNull(emailTokens.usedAt)))
    .returning({ id: emailTokens.id })
    .get();
  if (!claimed) throw new EmailTokenError('used');
  return { ...row, usedAt: now };
}

/** Retires every unused link of a kind (optionally all but one). Returns how many were retired. */
export function revokeEmailTokens(
  tx: DbOrTx,
  userId: string,
  type: EmailTokenType,
  now: number = Date.now(),
  exceptId?: string,
): number {
  const rows = tx
    .update(emailTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(emailTokens.userId, userId),
        eq(emailTokens.type, type),
        isNull(emailTokens.usedAt),
        exceptId === undefined ? undefined : ne(emailTokens.id, exceptId),
      ),
    )
    .returning({ id: emailTokens.id })
    .all();
  return rows.length;
}

/** When the user's newest link of this kind was created (any state), or undefined. */
export function latestTokenAt(
  db: DbOrTx,
  userId: string,
  type: EmailTokenType,
): number | undefined {
  return db
    .select({ createdAt: emailTokens.createdAt })
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.type, type)))
    .orderBy(desc(emailTokens.createdAt), desc(emailTokens.id))
    .limit(1)
    .get()?.createdAt;
}
