import type { RateLimitOptions } from '@/server/http/route';

/** The export reads everything the user owns: three a day is plenty for a person. */
export const ACCOUNT_EXPORT_RATE_LIMIT: RateLimitOptions = {
  name: 'account-export',
  limit: 3,
  windowSec: 86_400,
  by: 'user',
};

/**
 * Each attempt costs a scrypt verification and confirms or denies the password, and the call is
 * destructive: it is as tight as changing the password.
 */
export const ACCOUNT_DELETE_RATE_LIMIT: RateLimitOptions = {
  name: 'account-delete',
  limit: 5,
  windowSec: 3600,
  by: 'user',
};
