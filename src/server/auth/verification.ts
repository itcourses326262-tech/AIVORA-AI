import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import { getDb, withTx, type DbOrTx, type Tx } from '@/server/db';
import { creditLedger, users, type UserRow } from '@/server/db/schema';
import { getEnv } from '@/server/env';
import { signupBonusKey, grantSignupBonus, type SignupBonus } from './bonus';
import { isEmailVerificationRequired } from './email-policy';
import { EmailTokenError, consumeEmailToken, issueEmailToken, latestTokenAt } from './email-tokens';
import { queueVerificationEmail, queueWelcomeEmail, type Recipient } from './notifications';

/** A new confirmation link can be requested this often. */
export const RESEND_COOLDOWN_SEC = 60;
const RESEND_COOLDOWN_MS = RESEND_COOLDOWN_SEC * 1000;

export function toRecipient(user: Pick<UserRow, 'email' | 'name' | 'locale'>): Recipient {
  return { email: user.email, name: user.name, locale: user.locale };
}

/** Credits the user would still receive on confirming (0 when already granted or switched off). */
export function pendingSignupBonus(db: DbOrTx, user: Pick<UserRow, 'id'>): number {
  const granted = db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, signupBonusKey(user.id)))
    .get();
  return granted ? 0 : getEnv().SIGNUP_BONUS_CREDITS;
}

export interface VerifiedOutcome {
  user: UserRow;
  /** False when the address had been confirmed before. */
  changed: boolean;
  bonus: SignupBonus | null;
}

/**
 * Marks the address confirmed (compare-and-set on the unconfirmed state), grants the sign-up bonus
 * if the account never got one, and promotes an `ADMIN_EMAILS` address to admin: whoever proves
 * the mailbox is its owner, which a bare registration never did. Idempotent. Synchronous, so the
 * callers run it in the same transaction that consumes the emailed link (or applies the operator's
 * decision), and a failure anywhere burns nothing.
 */
export function markEmailVerified(
  tx: Tx,
  userId: string,
  now: number = Date.now(),
): VerifiedOutcome {
  const row = tx.select().from(users).where(eq(users.id, userId)).get();
  if (!row || row.deletedAt !== null) throw AppError.of('not_found', 'User not found');

  const flipped = tx
    .update(users)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
    .returning({ id: users.id })
    .get();

  const env = getEnv();
  if (row.role !== 'admin' && env.ADMIN_EMAILS.includes(row.email)) {
    tx.update(users).set({ role: 'admin', updatedAt: now }).where(eq(users.id, userId)).run();
  }
  const bonus = grantSignupBonus(tx, row, env.SIGNUP_BONUS_CREDITS, now);
  const user = tx.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error('User row missing right after verification');
  return { user, changed: flipped !== undefined, bonus };
}

export interface VerificationState {
  /** The policy: unconfirmed accounts cannot create generations. */
  required: boolean;
  verified: boolean;
  email: string;
  /** Seconds until a new link may be requested (0: now). */
  resendAfterSec: number;
  /** Free credits confirming would add (0: none, or already granted). */
  bonusCredits: number;
}

/** For the app shell. Null for an unknown, deleted or disabled account. */
export function getVerificationState(
  userId: string,
  now: number = Date.now(),
): VerificationState | null {
  const db = getDb();
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row || row.deletedAt !== null) return null;
  const last = latestTokenAt(db, userId, 'verify');
  const wait = last === undefined ? 0 : Math.ceil((last + RESEND_COOLDOWN_MS - now) / 1000);
  return {
    required: isEmailVerificationRequired(),
    verified: row.emailVerifiedAt !== null,
    email: row.email,
    resendAfterSec: Math.max(0, wait),
    bonusCredits: pendingSignupBonus(db, row),
  };
}

export interface RequestVerificationResult {
  sent: boolean;
  verified: boolean;
  resendAfterSec: number;
}

/**
 * Emails a fresh confirmation link. Already confirmed accounts get `{ sent: false, verified: true }`
 * (the banner simply disappears). Asking again within {@link RESEND_COOLDOWN_SEC} is a 429
 * `rate_limited` whose `details.retryAfterSec` says how long to wait. The email goes out in the
 * background: a slow relay never holds the request.
 */
export async function requestEmailVerification(
  userId: string,
  now: number = Date.now(),
): Promise<RequestVerificationResult> {
  const db = getDb();
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row || row.deletedAt !== null || row.disabledAt !== null) {
    throw AppError.of('not_found', 'User not found');
  }
  if (row.emailVerifiedAt !== null) return { sent: false, verified: true, resendAfterSec: 0 };

  const issued = withTx(db, (tx) => {
    const last = latestTokenAt(tx, userId, 'verify');
    if (last !== undefined && now - last < RESEND_COOLDOWN_MS) {
      const retryAfterSec = Math.max(1, Math.ceil((last + RESEND_COOLDOWN_MS - now) / 1000));
      throw AppError.of('rate_limited', 'A confirmation email was sent a moment ago', {
        retryAfterSec,
      });
    }
    return issueEmailToken(tx, userId, 'verify', now);
  });
  queueVerificationEmail(toRecipient(row), issued.secret, pendingSignupBonus(db, row));
  return { sent: true, verified: false, resendAfterSec: RESEND_COOLDOWN_SEC };
}

export interface ConfirmVerificationResult {
  verified: true;
  /** True when the address had been confirmed before this link was used. */
  alreadyVerified: boolean;
  /** Credits this confirmation added to the balance (0 when none). */
  bonusCredits: number;
}

/**
 * Uses a confirmation link: marks the address confirmed and grants the sign-up bonus in ONE
 * transaction with burning the link, so a failure leaves the link usable. `bad_request` with
 * `details.reason` (`invalid`, `expired`, `used`) for a link that cannot be used. The link is
 * the credential here: callers need no session, the address on the account is what gets confirmed.
 */
export function confirmEmailVerification(
  secret: string,
  now: number = Date.now(),
): ConfirmVerificationResult {
  const outcome = withTx(getDb(), (tx) => {
    const token = consumeEmailToken(tx, 'verify', secret, now);
    const owner = tx.select().from(users).where(eq(users.id, token.userId)).get();
    // An account that is gone or switched off cannot be confirmed; the link is not burned.
    if (!owner || owner.deletedAt !== null || owner.disabledAt !== null) {
      throw new EmailTokenError('invalid');
    }
    return markEmailVerified(tx, token.userId, now);
  });
  const bonusCredits = outcome.bonus?.created ? outcome.bonus.entry.delta : 0;
  if (outcome.changed) queueWelcomeEmail(toRecipient(outcome.user), bonusCredits);
  return { verified: true, alreadyVerified: !outcome.changed, bonusCredits };
}

/**
 * The operator's version of {@link requestEmailVerification}: no resend gap (an admin decides),
 * same link, same email. Returns false when the address is already confirmed. Not for routes.
 */
export function resendVerificationNow(userId: string, now: number = Date.now()): boolean {
  const db = getDb();
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row || row.deletedAt !== null) throw AppError.of('not_found', 'User not found');
  if (row.emailVerifiedAt !== null) return false;
  const issued = withTx(db, (tx) => issueEmailToken(tx, userId, 'verify', now));
  queueVerificationEmail(toRecipient(row), issued.secret, pendingSignupBonus(db, row));
  return true;
}
