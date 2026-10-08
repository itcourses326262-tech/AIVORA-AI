import 'server-only';
import type { Kind } from '@/lib/catalog/types';

const POLL_GROWTH = 1.5;
const POLL_BOUNDS_MS: Record<Kind, { first: number; max: number }> = {
  image: { first: 1_000, max: 3_000 },
  video: { first: 3_000, max: 10_000 },
};
const RETRY_FIRST_MS = 2_000;
const RETRY_MAX_MS = 30_000;
const JITTER = 0.2;

/** `ms` spread by +-20% so many workers polling the same provider do not move in lockstep. */
function jittered(ms: number, random: () => number): number {
  return Math.round(ms * (1 - JITTER + 2 * JITTER * random()));
}

/**
 * Waits between provider polls: images 1 s growing to 3 s, videos 3 s growing to 10 s, each wait
 * jittered. Short at first so quick jobs feel quick, long later so slow ones do not hammer the API.
 */
export function createPollBackoff(kind: Kind, random: () => number): { next(): number } {
  const { first, max } = POLL_BOUNDS_MS[kind];
  let current = first;
  return {
    next() {
      const wait = jittered(current, random);
      current = Math.min(max, current * POLL_GROWTH);
      return wait;
    },
  };
}

/**
 * Wait before retry number `attempt` (1 is the first retry): 2 s, 4 s, 8 s ... capped at 30 s and
 * jittered. A provider's own `Retry-After` wins when it asks for longer.
 */
export function retryDelayMs(attempt: number, random: () => number, retryAfterMs?: number): number {
  const exponential = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.max(0, attempt - 1));
  return Math.max(jittered(exponential, random), Math.min(retryAfterMs ?? 0, 60_000));
}
