import { AppError } from '@/lib/errors';
import { getRateLimiter } from '@/server/security/rate-limit';

// Deliberate budgets, because the default 300/min bucket is shared by everything that forgets to
// choose one. Each name is its own bucket, per user unless said otherwise.

/** Starting a generation spends credits and provider money (section 9: 30 per minute). */
export const GENERATION_CREATE_LIMIT = {
  name: 'generations-create',
  limit: 30,
  windowSec: 60,
  by: 'user',
} as const;

/**
 * Reading. The studio polls the running generations every 1.5 to 4 seconds (`?ids=`, one request
 * for all of them) from every open tab, and a gallery scrolls through pages, so this is generous.
 * Every read is an indexed lookup scoped to the caller.
 */
export const GENERATION_READ_LIMIT = {
  name: 'generations-read',
  limit: 600,
  windowSec: 60,
  by: 'user',
} as const;

/** Favorite, share, cancel and delete are clicks. */
export const GENERATION_WRITE_LIMIT = {
  name: 'generations-write',
  limit: 60,
  windowSec: 60,
  by: 'user',
} as const;

/** `?q=` scans the user's prompts with LIKE, which costs more than an indexed page. */
const SEARCH_LIMIT = { name: 'generations-search', limit: 60, windowSec: 60 } as const;

/** The public feed: no account, so per client address. */
export const EXPLORE_LIMIT = { name: 'explore', limit: 60, windowSec: 60, by: 'ip' } as const;

/**
 * The feed's budget when the client address is `unknown`, i.e. no trusted proxy (`TRUST_PROXY`
 * unset, section 16 "Client address"): every visitor shares this one bucket, so a budget sized for
 * one client would let anybody switch the feed off for everybody. The answer is an indexed read the
 * browser or a CDN may cache for 15 s, so this only has to stop a flood, not meter a person.
 */
export const EXPLORE_SHARED_LIMIT = {
  name: 'explore-shared',
  limit: 1200,
  windowSec: 60,
  by: 'ip',
} as const;

/** The extra budget a text search spends on top of the read limit. */
export function enforceSearchLimit(userId: string): void {
  const hit = getRateLimiter().hit(
    `${SEARCH_LIMIT.name}:user:${userId}`,
    SEARCH_LIMIT.limit,
    SEARCH_LIMIT.windowSec,
  );
  if (!hit.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000));
    throw AppError.of('rate_limited', 'Too many searches', { retryAfterSec });
  }
}
