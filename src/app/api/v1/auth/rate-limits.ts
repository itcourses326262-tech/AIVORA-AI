import type { RateLimitOptions } from '@/server/http/route';

/*
 * Deliberate budgets for the credential endpoints (docs/ARCHITECTURE.md section 9). They are
 * counted per client address; with TRUST_PROXY=false every client shares the `unknown` address, so
 * behind a reverse proxy set TRUST_PROXY=true to get one budget per visitor.
 */

/** Creating accounts is the main abuse vector (bonus credits), so it is tight: 5 per hour. */
export const REGISTER_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-register',
  limit: 5,
  windowSec: 3600,
  by: 'ip',
};

/**
 * Per address. `loginUser` adds a second limit per address AND email, so one address cannot
 * grind through many passwords for one account, nor through many accounts.
 */
export const LOGIN_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-login',
  limit: 10,
  windowSec: 60,
  by: 'ip',
};

export const LOGOUT_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-logout',
  limit: 30,
  windowSec: 60,
  by: 'ip',
};

/** The studio asks on focus and after spending credits; per signed-in user, per address otherwise. */
export const ME_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-me',
  limit: 120,
  windowSec: 60,
  by: 'user',
};
