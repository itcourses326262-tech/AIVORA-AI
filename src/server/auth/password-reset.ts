import 'server-only';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, withTx } from '@/server/db';
import { users } from '@/server/db/schema';
import { getLogger } from '@/server/logger';
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
 * Mails a reset link to the account behind `rawEmail`, if there is an active one. Returns whether
 * a message was queued; the HTTP layer must NOT let that show: the route answers every request the
 * same way and calls this after responding (see `runInBackground`). Unknown, disabled and deleted
 * accounts get nothing.
 */
export function requestPasswordReset(rawEmail: string, now: number = Date.now()): boolean {
  const email = normalizeEmail(rawEmail);
  if (email === '') return false;
  const db = getDb();
  const row = db.select().from(users).where(eq(users.email, email)).get();
  if (!row || row.disabledAt !== null || row.deletedAt !== null) return false;

  const issued = withTx(db, (tx) => {
    const last = latestTokenAt(tx, row.id, 'reset');
    if (last !== undefined && now - last < RESET_MIN_GAP_MS) return null;
    return issueEmailToken(tx, row.id, 'reset', now);
  });
  if (!issued) return false;
  queuePasswordResetEmail(toRecipient(row), issued.secret);
  return true;
}

/**
 * Sets a new password with a reset link. In one transaction: burns the link (single use, one
 * hour), stores the hash, signs the account out EVERYWHERE, retires every other outstanding reset
 * link and confirms the address (receiving the mail proves the mailbox). Afterwards a "your
 * password was changed" notice goes out. API keys are separate credentials and stay valid.
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

  const updated = withTx(db, (tx) => {
    const consumed = consumeEmailToken(tx, 'reset', secret, now);
    const changed = tx
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(and(eq(users.id, consumed.userId), isNull(users.disabledAt), isNull(users.deletedAt)))
      .returning({ id: users.id })
      .get();
    // The account was disabled or deleted while the new hash was being computed.
    if (!changed) throw new EmailTokenError('invalid');
    revokeEmailTokens(tx, consumed.userId, 'reset', now);
    revokeOtherSessions(tx, consumed.userId);
    return markEmailVerified(tx, consumed.userId, now).user;
  });
  getLogger().info('Password reset completed', { component: 'auth', userId: updated.id });
  queuePasswordChangedEmail(toRecipient(updated), now);
}
