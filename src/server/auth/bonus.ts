import 'server-only';
import { eq } from 'drizzle-orm';
import { grantCredits, type LedgerEntry } from '@/server/credits';
import type { DbOrTx, Tx } from '@/server/db';
import { creditLedger, signupBonusClaims, type UserRow } from '@/server/db/schema';
import { getLogger } from '@/server/logger';
import { canonicalizeEmail } from './email-canonical';
import type { Env } from '@/server/env';
import { isFirebaseAuthEnabled } from './firebase';
import { hashToken } from './tokens';

/** How an account came to exist or was confirmed: only some of them earn the free credits. */
export type SignupMethod = 'google' | 'password';

/**
 * The product policy: the free sign-up credits go to accounts created (or first linked) through
 * Google sign-in. Password accounts get none unless SIGNUP_BONUS_PROVIDER=any (development, tests).
 */
export function earnsSignupBonus(env: Env, method: SignupMethod): boolean {
  if (env.SIGNUP_BONUS_CREDITS <= 0) return false;
  return method === 'google' || env.SIGNUP_BONUS_PROVIDER === 'any';
}

/**
 * The number of free credits the pages may promise a visitor: 0 unless a visitor can really earn
 * them through Google sign-in here (set up, sign-up open). Password accounts that earn them under
 * SIGNUP_BONUS_PROVIDER=any (development, tests) are never advertised.
 */
export function signupBonusOffer(env: Env): number {
  // Only the Google route is ever advertised ("N free credits when you sign up with Google"): a
  // visitor cannot take it when sign-up is closed or when there is no Google button to press.
  const reachable =
    env.SIGNUP_ENABLED && isFirebaseAuthEnabled(env) && earnsSignupBonus(env, 'google');
  return reachable ? env.SIGNUP_BONUS_CREDITS : 0;
}

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
