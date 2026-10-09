import 'server-only';
import { eq } from 'drizzle-orm';
import { grantCredits, type LedgerEntry } from '@/server/credits';
import type { DbOrTx, Tx } from '@/server/db';
import { creditLedger, signupBonusClaims, type UserRow } from '@/server/db/schema';
import { getLogger } from '@/server/logger';
import { canonicalizeEmail } from './email-canonical';
import { hashToken } from './tokens';

export interface SignupBonus {
  entry: LedgerEntry;
  /** False when the bonus had been granted before and this call only found it. */
  created: boolean;
}

/** The ledger key that makes the bonus idempotent per user. */
export function signupBonusKey(userId: string): string {
  return `signup_bonus:${userId}`;
}

type BonusRecipient = Pick<UserRow, 'id' | 'email' | 'emailCanonical'>;

/** What the per-mailbox claim is stored under: a keyed hash, so the table names nobody. */
function claimHash(user: BonusRecipient): string {
  return hashToken(`signup-bonus:${user.emailCanonical ?? canonicalizeEmail(user.email)}`);
}

/**
 * True when ANOTHER account (typically a deleted one under the same address) already received the
 * sign-up bonus of this user's mailbox, so granting would be refused. Lets the confirmation email
 * and the banner promise only what confirming will really give.
 */
export function isBonusClaimedByAnother(db: DbOrTx, user: BonusRecipient): boolean {
  const claim = db
    .select({ userId: signupBonusClaims.userId })
    .from(signupBonusClaims)
    .where(eq(signupBonusClaims.keyHash, claimHash(user)))
    .get();
  return claim !== undefined && claim.userId !== user.id;
}

/**
 * Grants the free sign-up credits, at most once per user AND at most once per mailbox.
 *
 * - Per user: the credits module replays the ledger idempotency key `signup_bonus:<userId>`, and a
 *   bonus that already exists (granted at registration under another policy, say) is left alone
 *   even if SIGNUP_BONUS_CREDITS changed since.
 * - Per mailbox: `signup_bonus_claims` remembers a keyed hash of the canonical address for good,
 *   also after the account is deleted, so deleting and registering again cannot claim a second
 *   bonus. Another account holding the claim means no bonus (null).
 *
 * Synchronous: call it inside the transaction that confirms or creates the account.
 */
export function grantSignupBonus(
  tx: Tx,
  user: BonusRecipient,
  amount: number,
  now: number = Date.now(),
): SignupBonus | null {
  if (amount <= 0) return null;
  const key = signupBonusKey(user.id);
  const existing = tx.select().from(creditLedger).where(eq(creditLedger.idempotencyKey, key)).get();
  if (existing) return { entry: existing, created: false };

  const keyHash = claimHash(user);
  const claim = tx
    .select()
    .from(signupBonusClaims)
    .where(eq(signupBonusClaims.keyHash, keyHash))
    .get();
  if (claim && claim.userId !== user.id) {
    getLogger().info('Sign-up bonus withheld: this mailbox already received one', {
      component: 'auth',
      userId: user.id,
    });
    return null;
  }
  if (!claim)
    tx.insert(signupBonusClaims).values({ keyHash, userId: user.id, createdAt: now }).run();
  const entry = grantCredits(tx, {
    userId: user.id,
    amount,
    reason: 'signup_bonus',
    idempotencyKey: key,
  });
  return { entry, created: true };
}
