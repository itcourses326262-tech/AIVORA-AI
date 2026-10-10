import 'server-only';
import { eq, and, isNull, or } from 'drizzle-orm';
import { getDb, withTx, type Db } from '@/server/db';
import { users, type UserRow } from '@/server/db/schema';
import { getLogger } from '@/server/logger';
import { getRateLimiter } from '@/server/security/rate-limit';
import { revokeAllApiKeys } from './api-keys';
import { canonicalizeEmail } from './email-canonical';
import {
  EmailTokenError,
  consumeEmailToken,
  findEmailToken,
  issueEmailToken,
  latestTokenAt,
  revokeEmailTokens,
} from './email-tokens';
import { queuePasswordChangedEmail, queuePasswordResetEmail } from './notifications';
import { assertPasswordPolicy, hashPassword } from './password';
import { revokeOtherSessions } from './sessions';
import { normalizeEmail } from './validation';
import { markEmailVerified, toRecipient } from './verification';

/** A second reset link is not mailed to the same account within this time (mail-bombing guard). */
export const RESET_MIN_GAP_MS = 60_000;

/**
 * Reset links one ACCOUNT is mailed per window. Counted per account (not per typed address) and only
 * when a mail really goes out, so requests that match no account, or that the 60 s gap turns away,
 * can never use up the budget of a real owner. Per process, like every limiter here.
 */
export const RESET_MAIL_BUDGET = { name: 'auth-reset-mail', limit: 3, windowSec: 3600 } as const;

/**
 * The account behind a typed address: the exact address first, otherwise the account that owns the
 * same MAILBOX (`v.ictim+x@gmail.com` is the mailbox `victim@gmail.com`). Registration refuses a
 * second account for one mailbox, so the owner of a mailbox that an alias registration got to
 * first is still able to recover it. The link is mailed to the address ON FILE, which lives in
 * that same mailbox, so finding an account by an alias reveals nothing to the requester.
 */
function findAccountByMailbox(db: Db, email: string): UserRow | undefined {
  const canonical = canonicalizeEmail(email);
  const rows = db
    .select()
    .from(users)
    .where(
      or(
        eq(users.email, email),
        eq(users.emailCanonical, canonical),
        // Rows from before the canonical column hold the address as typed.
        eq(users.email, canonical),
      ),
    )
    .all();
  return rows.find((row) => row.email === email) ?? rows[0];
}

/**
 * Mails a reset link to the account behind `rawEmail`, if there is an active one. Returns whether
 * a message was queued; the HTTP layer must NOT let that show: the route answers every request the
 * same way and calls this after responding (see `runInBackground`). Unknown, disabled and deleted
 * accounts get nothing, and neither does an account that was mailed a link a minute ago or
 * {@link RESET_MAIL_BUDGET} links in the last hour (links already sent stay valid for an hour).
 */
export function requestPasswordReset(rawEmail: string, now: number = Date.now()): boolean {
  const email = normalizeEmail(rawEmail);
  if (email === '') return false;
  const db = getDb();
  const row = findAccountByMailbox(db, email);
  if (!row || row.disabledAt !== null || row.deletedAt !== null) return false;

  const issued = withTx(db, (tx) => {
    const last = latestTokenAt(tx, row.id, 'reset');
    if (last !== undefined && now - last < RESET_MIN_GAP_MS) return null;
    const { name, limit, windowSec } = RESET_MAIL_BUDGET;
    if (!getRateLimiter().hit(`${name}:${row.id}`, limit, windowSec).allowed) return null;
    return issueEmailToken(tx, row.id, 'reset', now);
  });
  if (!issued) return false;
  queuePasswordResetEmail(toRecipient(row), issued.secret);
  return true;
}

/**
 * Sets a new password with a reset link. In one transaction: burns the link (single use, one
 * hour), stores the hash, signs the account out EVERYWHERE, revokes every API key, retires every
 * other outstanding reset link and confirms the address (receiving the mail proves the mailbox).
 * Afterwards a "your password was changed" notice goes out.
 *
 * A reset is the way back into an account whose credentials can no longer be trusted (forgotten,
 * stolen, or opened by someone who typed the owner's address first), so it must leave the owner
 * as the only party holding anything: sessions AND keys go. Changing the password while signed in
 * (`changePassword`) is different, the caller is already authenticated, and keeps the keys.
 *
 * `bad_request` with `details.reason` for a link that cannot be used (checked BEFORE the password,
 * so a weak password is a 422 that leaves the link usable), 422 for a password the policy refuses.
 */
export async function resetPassword(
  secret: string,
  newPassword: string,
  now: number = Date.now(),
): Promise<void> {
  const db = getDb();
  const token = findEmailToken(db, 'reset', secret);
  if (!token) throw new EmailTokenError('invalid');
  if (token.usedAt !== null) throw new EmailTokenError('used');
  if (token.expiresAt <= now) throw new EmailTokenError('expired');
  const owner = db.select().from(users).where(eq(users.id, token.userId)).get();
  if (!owner || owner.disabledAt !== null || owner.deletedAt !== null) {
    throw new EmailTokenError('invalid');
  }

  assertPasswordPolicy(newPassword, { email: owner.email });
  const passwordHash = await hashPassword(newPassword);

  const { user, keysRevoked } = withTx(db, (tx) => {
    const consumed = consumeEmailToken(tx, 'reset', secret, now);
    const changed = tx
      .update(users)
      // A Google-only account gets its first real password here, and from now on has one.
      .set({ passwordHash, hasPassword: true, updatedAt: now })
      .where(and(eq(users.id, consumed.userId), isNull(users.disabledAt), isNull(users.deletedAt)))
      .returning({ id: users.id })
      .get();
    // The account was disabled or deleted while the new hash was being computed.
    if (!changed) throw new EmailTokenError('invalid');
    revokeEmailTokens(tx, consumed.userId, 'reset', now);
    revokeOtherSessions(tx, consumed.userId);
    const revoked = revokeAllApiKeys(tx, consumed.userId, now);
    // The mailbox owner chose this password and nothing else still works: the one moment an
    // ADMIN_EMAILS address may be promoted without trusting whoever registered it first.
    const verified = markEmailVerified(tx, consumed.userId, now, {
      bonus: 'password',
      promoteAdmin: true,
    });
    return { user: verified.user, keysRevoked: revoked };
  });
  getLogger().info('Password reset completed', {
    component: 'auth',
    userId: user.id,
    keysRevoked,
  });
  queuePasswordChangedEmail(toRecipient(user), now, keysRevoked);
}
