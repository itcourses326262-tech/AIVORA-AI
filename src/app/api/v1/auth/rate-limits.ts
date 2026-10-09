import type { RateLimitOptions } from '@/server/http/route';

/*
 * Deliberate budgets for the credential endpoints (docs/ARCHITECTURE.md section 9 and 16). They are
 * counted per client address. Without a trusted reverse proxy (TRUST_PROXY=false) the app cannot
 * tell its clients apart: the address is `unknown` and every visitor would share one bucket, so a
 * handful of requests could shut the endpoint for everybody. For that case each endpoint below has
 * a `*_SHARED_*` budget (or none) chosen for a bucket that all visitors share; behind a proxy
 * (TRUST_PROXY=true) every visitor gets the per-address budget.
 */

/** Creating accounts is the main abuse vector (bonus credits), so it is tight: 5 per hour. */
export const REGISTER_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-register',
  limit: 5,
  windowSec: 3600,
  by: 'ip',
};

/**
 * Unknown address: one budget for the whole site. Too small and anybody can close sign-up for
 * everybody with a few requests; unbounded and a script can farm signup bonuses without limit
 * (each bonus costs real money once a paid provider is configured). 60 an hour caps the free
 * credits that can be issued per hour at 60 times SIGNUP_BONUS_CREDITS, and a busy launch stays
 * below it. The only real fix is to run behind a proxy and set TRUST_PROXY=true.
 *
 * Only sign-ups that succeed count (`count: 'successes'`): a refused attempt creates nothing and
 * costs next to nothing (invalid bodies are rejected before the password is hashed, and the hash
 * gate caps the rest), so counting it would let a script close registration for everybody with 60
 * garbage requests. What it can still do is create 60 real accounts an hour, which is exactly the
 * ceiling this budget exists for (and `SIGNUPS_PER_IP_PER_DAY` bounds the day).
 */
export const REGISTER_SHARED_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-register-shared',
  limit: 60,
  windowSec: 3600,
  by: 'ip',
  count: 'successes',
};

/**
 * Per address. `loginUser` adds a second limit per address AND email, so one address cannot
 * grind through many passwords for one account, nor through many accounts.
 *
 * With an unknown address there is deliberately NO address-wide login budget: it would be one
 * bucket for all visitors, and 11 failed logins a minute would lock everybody out. What still
 * applies is the per-email limit inside `loginUser` (10 a minute per account, which then means
 * per account for all clients together) and the password hash gate, which caps concurrent scrypt
 * work and answers 429 when saturated.
 */
export const LOGIN_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-login',
  limit: 10,
  windowSec: 60,
  by: 'ip',
};

/** Signing out is one indexed delete: with an unknown address it is not limited at all. */
export const LOGOUT_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-logout',
  limit: 30,
  windowSec: 60,
  by: 'ip',
};

/** Needs a session, so it is counted per user and never shares a bucket with other visitors. */
export const LOGOUT_ALL_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-logout-all',
  limit: 10,
  windowSec: 60,
  by: 'user',
};

/** The studio asks on focus and after spending credits; per signed-in user, per address otherwise. */
export const ME_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-me',
  limit: 120,
  windowSec: 60,
  by: 'user',
};

/**
 * Unknown address: signed-in callers keep a per-user bucket (ten times roomier, it is only a guard
 * against a runaway loop), anonymous ones share this bucket, so it has to be large: an anonymous
 * answer costs next to nothing.
 */
export const ME_SHARED_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-me-shared',
  limit: 1200,
  windowSec: 60,
  by: 'user',
};
