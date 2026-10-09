import 'server-only';
import { AppError } from '@/lib/errors';
import type { RateLimitOptions } from '@/server/http/route';
import { getRateLimiter, type RateLimitResult } from '@/server/security/rate-limit';

/**
 * A budget for NEW accounts only, for a sign-in route that mostly serves returning people. The
 * route-level `count: 'successes'` cannot do this: a returning Google user succeeds too, so sixty
 * of them in an hour would close the budget for everybody. Here a hit is spent when an account is
 * about to be created (`admit`, called from inside the sign-in) and given back unless one was
 * (`settle`), so the bucket counts exactly the accounts created, like password registration does
 * with `count: 'successes'`. Passing the registration budget makes both ways of signing up spend
 * the same bucket.
 */
export interface NewAccountBudget {
  /** Spends one hit; throws `rate_limited` (with the wait) when the budget is gone. */
  admit(): void;
  /**
   * Call once the sign-in is over, whatever happened: every hit that did not end in a new account
   * is given back (a refusal later in the sign-in, a failure, an account that already existed).
   */
  settle(created: boolean): void;
}

export function newAccountBudget(options: RateLimitOptions, scope: string): NewAccountBudget {
  const limiter = getRateLimiter();
  const key = `${options.name}:${scope}`;
  const held: RateLimitResult[] = [];
  return {
    admit() {
      const result = limiter.hit(key, options.limit, options.windowSec);
      if (!result.allowed) {
        // A hit the budget itself refused stays counted: hammering must not shorten the wait.
        const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
        throw AppError.of('rate_limited', 'Too many requests', { retryAfterSec });
      }
      held.push(result);
    },
    settle(created) {
      // At most one account comes out of one sign-in; a retried transaction may have spent twice.
      for (const result of held.splice(created ? 1 : 0)) limiter.release?.(key, result);
    },
  };
}
