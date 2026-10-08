import 'server-only';
import { getEnv } from '@/server/env';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms at which the current window resets. */
  resetAt: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): RateLimitResult;
}

interface Window {
  count: number;
  resetAt: number;
}

export interface InMemoryRateLimiterOptions {
  /** Most keys tracked at once; the least recently hit one is evicted beyond it. */
  maxKeys?: number;
  /** Expired windows are dropped at most this often (from inside `hit`, so there is no timer). */
  sweepIntervalMs?: number;
}

/** Roughly 100 bytes per key: a flood of unique keys cannot grow the process past ~10 MB. */
export const DEFAULT_MAX_KEYS = 100_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

/**
 * Fixed-window counters in a Map. A key starts a window on its first hit and is blocked once it
 * has made more than `limit` hits before the window ends; blocked hits still count, so hammering
 * does not shorten the wait. State is per process: behind several instances each one enforces its
 * own budget.
 *
 * Memory is bounded two ways. Expired windows are swept lazily, and the Map is capped at
 * `maxKeys`: every hit moves its key to the end of the Map's insertion order, so the first key
 * is always the least recently used and is the one evicted. An attacker who floods unique keys
 * therefore resets idle counters, never the counter of a client that keeps hitting.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly maxKeys: number;
  private readonly sweepIntervalMs: number;
  private nextSweepAt = 0;

  constructor(
    private readonly now: () => number = Date.now,
    options: InMemoryRateLimiterOptions = {},
  ) {
    this.maxKeys = Math.max(1, Math.floor(options.maxKeys ?? DEFAULT_MAX_KEYS));
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  /** Number of keys currently tracked (expired ones linger until the next sweep). */
  get size(): number {
    return this.windows.size;
  }

  hit(key: string, limit: number, windowSec: number): RateLimitResult {
    const now = this.now();
    const windowMs = Math.max(1, windowSec) * 1000;
    this.sweep(now);

    let window = this.windows.get(key);
    // A window further away than its own length means the clock stepped back: start over.
    if (!window || window.resetAt <= now || window.resetAt - now > windowMs) {
      window = { count: 0, resetAt: now + windowMs };
    }
    // Delete and re-insert to mark the key as most recently used.
    this.windows.delete(key);
    this.windows.set(key, window);
    this.evictOverflow();

    window.count += 1;
    return {
      allowed: window.count <= limit,
      remaining: Math.max(0, limit - window.count),
      resetAt: window.resetAt,
    };
  }

  private evictOverflow(): void {
    while (this.windows.size > this.maxKeys) {
      const oldest = this.windows.keys().next();
      if (oldest.done) return;
      this.windows.delete(oldest.value);
    }
  }

  private sweep(now: number): void {
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + this.sweepIntervalMs;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * Stands in for the real limiter when RATE_LIMIT_DISABLED=true (end-to-end and load tests): lets
 * everything through but still reports sane numbers, so response headers keep their shape.
 */
export const unlimitedRateLimiter: RateLimiter = {
  hit: (_key, limit, windowSec) => ({
    allowed: true,
    remaining: limit,
    resetAt: Date.now() + windowSec * 1000,
  }),
};

// Kept on globalThis so Next.js dev HMR (which re-evaluates modules) does not reset every budget.
const LIMITER_KEY = Symbol.for('aivore.rate-limiter');
const OVERRIDE_KEY = Symbol.for('aivore.rate-limiter.override');
type GlobalWithLimiter = typeof globalThis & {
  [LIMITER_KEY]?: RateLimiter;
  [OVERRIDE_KEY]?: RateLimiter;
};

/**
 * The process-wide limiter: a limiter installed with {@link setRateLimiter} wins, then the
 * pass-through limiter when RATE_LIMIT_DISABLED=true, otherwise the in-memory default.
 */
export function getRateLimiter(): RateLimiter {
  const scope = globalThis as GlobalWithLimiter;
  if (scope[OVERRIDE_KEY]) return scope[OVERRIDE_KEY];
  if (getEnv().RATE_LIMIT_DISABLED) return unlimitedRateLimiter;
  return (scope[LIMITER_KEY] ??= new InMemoryRateLimiter());
}

/**
 * Replaces the process-wide limiter (a shared store, or a fake in tests); `null` restores the
 * default, with fresh counters.
 */
export function setRateLimiter(limiter: RateLimiter | null): void {
  const scope = globalThis as GlobalWithLimiter;
  scope[OVERRIDE_KEY] = limiter ?? undefined;
  scope[LIMITER_KEY] = undefined;
}
