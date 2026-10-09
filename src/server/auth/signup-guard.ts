import 'server-only';
import { and, count, gt, inArray, isNotNull, lte, min } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import type { DbOrTx } from '@/server/db';
import { users, type UserRow } from '@/server/db/schema';
import { getEnv, type Env } from '@/server/env';
import { UNKNOWN_IP } from '@/server/security/ip';
import { isDisposableEmail } from './disposable-domains';
import { hashToken } from './tokens';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the client address is unknown (no trusted proxy: every visitor looks the same) the cap is
 * this many times larger and shared by everybody. A budget sized for one client would let any
 * script close sign-up for the whole site, and one that a busy launch day exhausts would lock out
 * every newcomer; this is 1000 accounts a day at the default of 5 (the hourly register budget of
 * 60 would allow 1440), which still bounds how many bonus accounts a day can mint. The real fix
 * is `TRUST_PROXY=true` behind a reverse proxy.
 */
export const UNKNOWN_ADDRESS_CAP_FACTOR = 200;

/** Marks a stored sign-up address as a digest, not an address. */
const DIGEST_PREFIX = 'h:';

/** The address stored on the account, `unknown` included, so the shared cap can count them. */
export function signupAddress(ip: string | undefined): string {
  return ip && ip !== '' ? ip : UNKNOWN_IP;
}

/**
 * A keyed digest of a sign-up address. A deleted account keeps it in place of the address for the
 * rest of its first day, so the account still counts towards the cap of that address (deleting
 * and registering again would otherwise free the slot at once) while no address stays on file.
 */
export function digestSignupAddress(address: string): string {
  return `${DIGEST_PREFIX}${hashToken(`signup-address:${address}`)}`;
}

/**
 * What a deleted account keeps in `signupIp`: the digest of its address while it still counts
 * towards the daily cap (it was created within the last 24 hours), nothing otherwise.
 */
export function signupAddressAfterDeletion(
  account: Pick<UserRow, 'signupIp' | 'createdAt'>,
  now: number = Date.now(),
): string | null {
  if (account.signupIp === null || now - account.createdAt >= DAY_MS) return null;
  return digestSignupAddress(account.signupIp);
}

/**
 * Forgets the digests of deleted accounts whose first day is over (they no longer count towards
 * anything). Returns how many were cleared. Run by the purge scheduler.
 */
export function expireDeletedSignupAddresses(db: DbOrTx, now: number = Date.now()): number {
  return db
    .update(users)
    .set({ signupIp: null })
    .where(
      and(
        isNotNull(users.deletedAt),
        isNotNull(users.signupIp),
        lte(users.createdAt, now - DAY_MS),
      ),
    )
    .run().changes;
}

/** Accounts per rolling 24 hours for this address, or null when the cap is off. */
export function signupCapFor(
  ip: string | undefined,
  env: Pick<Env, 'SIGNUPS_PER_IP_PER_DAY' | 'RATE_LIMIT_DISABLED'> = getEnv(),
): number | null {
  // RATE_LIMIT_DISABLED exists so end-to-end suites can create many users from one address.
  if (env.RATE_LIMIT_DISABLED || env.SIGNUPS_PER_IP_PER_DAY === 0) return null;
  return signupAddress(ip) === UNKNOWN_IP
    ? env.SIGNUPS_PER_IP_PER_DAY * UNKNOWN_ADDRESS_CAP_FACTOR
    : env.SIGNUPS_PER_IP_PER_DAY;
}

/**
 * `signup_limit` (429) once the address created its share of accounts in the last 24 hours. Counts
 * the accounts that carry the address and the ones deleted since (they carry its digest), so
 * deleting an account does not make room for another. Call it inside the registration
 * transaction: the count and the insert are then one unit and two simultaneous sign-ups cannot
 * both slip under the cap.
 */
export function assertSignupsWithinCap(
  db: DbOrTx,
  ip: string | undefined,
  now: number = Date.now(),
): void {
  const cap = signupCapFor(ip);
  if (cap === null) return;
  const since = now - DAY_MS;
  const address = signupAddress(ip);
  const row = db
    .select({ total: count(), oldest: min(users.createdAt) })
    .from(users)
    .where(
      and(
        inArray(users.signupIp, [address, digestSignupAddress(address)]),
        gt(users.createdAt, since),
      ),
    )
    .get();
  if ((row?.total ?? 0) < cap) return;
  const retryAfterSec = Math.max(60, Math.ceil(((row?.oldest ?? now) + DAY_MS - now) / 1000));
  throw AppError.of('signup_limit', 'Too many accounts were created from this network today', {
    retryAfterSec,
  });
}

/** `email_not_allowed` (422) for a throwaway-mail domain (built-in list plus the operator's). */
export function assertEmailAllowed(email: string): void {
  if (isDisposableEmail(email, getEnv().DISPOSABLE_EMAIL_DOMAINS)) {
    throw AppError.of('email_not_allowed', 'Disposable email addresses are not accepted');
  }
}
