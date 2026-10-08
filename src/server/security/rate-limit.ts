// OWNER: auth-security — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms at which the current window resets. */
  resetAt: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): RateLimitResult;
}

/** The process-wide limiter (in-memory by default, swappable). */
export function getRateLimiter(): RateLimiter {
  throw new NotImplementedError('security.rate-limit');
}
