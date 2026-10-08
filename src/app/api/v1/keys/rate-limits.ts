import type { RateLimitOptions } from '@/server/http/route';

export const KEYS_READ_RATE_LIMIT: RateLimitOptions = {
  name: 'keys-read',
  limit: 60,
  windowSec: 60,
  by: 'user',
};

/** Creating or revoking a key is a rare, deliberate act. */
export const KEYS_WRITE_RATE_LIMIT: RateLimitOptions = {
  name: 'keys-write',
  limit: 10,
  windowSec: 60,
  by: 'user',
};
