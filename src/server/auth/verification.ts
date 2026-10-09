import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import { getDb, withTx, type DbOrTx, type Tx } from '@/server/db';
import { creditLedger, users, type UserRow } from '@/server/db/schema';
import { getEnv } from '@/server/env';
import {
  grantSignupBonus,
  isBonusClaimedByAnother,
  signupBonusKey,
  type SignupBonus,
} from './bonus';
import { isEmailVerificationRequired } from './email-policy';
import { EmailTokenError, consumeEmailToken, issueEmailToken, latestTokenAt } from './email-tokens';
import { queueVerificationEmail, queueWelcomeEmail, type Recipient } from './notifications';

/** A new confirmation link can be requested this often. */
export const RESEND_COOLDOWN_SEC = 60;
const RESEND_COOLDOWN_MS = RESEND_COOLDOWN_SEC * 1000;

export function toRecipient(user: Pick<UserRow, 'email' | 'name' | 'locale'>): Recipient {
  return { email: user.email, name: user.name, locale: user.locale };
}

/**
 * Credits the user would still receive on confirming: 0 when the bonus was already granted, is
 * switched off, or was already claimed by another account of the same mailbox (a deleted account
 * registered again), so no email or banner promises what confirming will not give.
 */
export function pendingSignupBonus(
  db: DbOrTx,
  user: Pick<UserRow, 'id' | 'email' | 'emailCanonical'>,
): number {
  const granted = db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, signupBonusKey(user.id)))
    .get();
  if (granted || isBonusClaimedByAnother(db, user)) return 0;
  return getEnv().SIGNUP_BONUS_CREDITS;
}

export interface VerifiedOutcome {
  user: UserRow;
  /** False when the address had been confirmed before. */
  changed: boolean;
  bonus: SignupBonus | null;
}

export interface MarkVerifiedOptions {
  /**
   * Also promote an `ADMIN_EMAILS` address to admin. Default false. Reading the emailed link
   * proves the MAILBOX, not that the owner of the mailbox is the one who holds the account: the
   * password and any live session were chosen by whoever registered first, who may be a squatter.
   * So only a caller that knows the holder is the mailbox owner passes true: a password reset (the
   * owner just chose the password and every old session and key is gone) or a confirmation made
   * from a session of that very account.
   */
  promoteAdmin?: boolean;
}

/**
 * Marks the address confirmed (compare-and-set on the unconfirmed state) and grants the sign-up
 * bonus if the account never got one. With `options.promoteAdmin` an `ADMIN_EMAILS` address also
 * becomes admin. Idempotent. Synchronous, so the callers run it in the same transaction that
 * consumes the emailed link (or applies the operator's decision), and a failure anywhere burns
 * nothing.
 */
export function markEmailVerified(
  tx: Tx,
  userId: string,
  now: number = Date.now(),
  options: MarkVerifiedOptions = {},
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
  if (
    options.promoteAdmin === true &&
    row.role !== 'admin' &&
    env.ADMIN_EMAILS.includes(row.email)
  ) {
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

export interface ConfirmOptions {
  /**
   * The account the request is signed in to (a browser SESSION, never an API key). When it is the
   * owner of the link, the person confirming holds both the account and the mailbox, and an
   * `ADMIN_EMAILS` address is promoted. Any other situation (no session, another account) only
   * confirms.
   */
  signedInUserId?: string;
}

/**
 * Uses a confirmation link: marks the address confirmed and grants the sign-up bonus in ONE
 * transaction with burning the link, so a failure leaves the link usable. `bad_request` with
 * `details.reason` (`invalid`, `expired`, `used`) for a link that cannot be used. The link is
 * the credential here: callers need no session, the address on the account is what gets confirmed.
 * Admin promotion follows {@link ConfirmOptions.signedInUserId}.
 */
export function confirmEmailVerification(
  secret: string,
  now: number = Date.now(),
  options: ConfirmOptions = {},
): ConfirmVerificationResult {
  const outcome = withTx(getDb(), (tx) => {
    const token = consumeEmailToken(tx, 'verify', secret, now);
    const owner = tx.select().from(users).where(eq(users.id, token.userId)).get();
    // An account that is gone or switched off cannot be confirmed; the link is not burned.
    if (!owner || owner.deletedAt !== null || owner.disabledAt !== null) {
      throw new EmailTokenError('invalid');
    }
    return markEmailVerified(tx, token.userId, now, {
      promoteAdmin: options.signedInUserId === token.userId,
    });
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
