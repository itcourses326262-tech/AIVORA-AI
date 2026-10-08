import type { RateLimitOptions } from '@/server/http/route';

/**
 * A gallery page loads dozens of thumbnails at once, infinite scroll fetches several pages in a
 * row, and a playing video issues a ranged request per seek. Throttling that would break normal
 * browsing, so the budget is high (20 requests per second); it still stops a script from
 * hammering the disk or the S3 egress. Signed-in callers are counted per user, anonymous viewers of
 * public pages per IP address.
 */
export const MEDIA_RATE_LIMIT: RateLimitOptions = {
  name: 'media',
  limit: 1200,
  windowSec: 60,
  by: 'user',
};
