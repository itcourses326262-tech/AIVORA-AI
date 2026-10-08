import 'server-only';
import { and, count, eq, gt, min } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import type { DbOrTx } from '@/server/db';
import { users } from '@/server/db/schema';
import { getEnv, type Env } from '@/server/env';
import { UNKNOWN_IP } from '@/server/security/ip';
import { isDisposableEmail } from './disposable-domains';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the client address is unknown (no trusted proxy: every visitor looks the same) the cap is
 * this many times larger and shared by everybody. A budget sized for one client would let any
 * script close sign-up for the whole site; this still bounds how many bonus accounts a day can
 * mint. The real fix is `TRUST_PROXY=true` behind a reverse proxy.
 */
export const UNKNOWN_ADDRESS_CAP_FACTOR = 20;

/** The address stored on the account, `unknown` included, so the shared cap can count them. */
export function signupAddress(ip: string | undefined): string {
  return ip && ip !== '' ? ip : UNKNOWN_IP;
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
 * the accounts that still carry the address (a deleted account does not: its address is erased).
 * Call it inside the registration transaction: the count and the insert are then one unit and two
 * simultaneous sign-ups cannot both slip under the cap.
 */
export function assertSignupsWithinCap(
  db: DbOrTx,
  ip: string | undefined,
  now: number = Date.now(),
): void {
  const cap = signupCapFor(ip);
  if (cap === null) return;
  const since = now - DAY_MS;
  const row = db
    .select({ total: count(), oldest: min(users.createdAt) })
    .from(users)
    .where(and(eq(users.signupIp, signupAddress(ip)), gt(users.createdAt, since)))
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
