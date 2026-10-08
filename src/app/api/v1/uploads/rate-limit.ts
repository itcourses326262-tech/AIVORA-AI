import type { RateLimitOptions } from '@/server/http/route';

/**
 * Each upload costs a decode, a re-encode and a thumbnail, so this is deliberately tight: a
 * person drags a handful of images into the studio, not twenty a second. Counted per user.
 */
export const UPLOAD_RATE_LIMIT: RateLimitOptions = {
  name: 'uploads',
  limit: 20,
  windowSec: 60,
  by: 'user',
};
