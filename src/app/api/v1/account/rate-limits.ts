import type { RateLimitOptions } from '@/server/http/route';

/** Reading the profile happens on every page load of the account area. */
export const ACCOUNT_READ_RATE_LIMIT: RateLimitOptions = {
  name: 'account-read',
  limit: 60,
  windowSec: 60,
  by: 'user',
};

export const ACCOUNT_WRITE_RATE_LIMIT: RateLimitOptions = {
  name: 'account-write',
  limit: 20,
  windowSec: 60,
  by: 'user',
};

/**
 * Each attempt costs a scrypt verification, and the endpoint confirms or denies the current
 * password, so it is the tightest of the account limits.
 */
export const PASSWORD_RATE_LIMIT: RateLimitOptions = {
  name: 'account-password',
  limit: 5,
  windowSec: 60,
  by: 'user',
};
