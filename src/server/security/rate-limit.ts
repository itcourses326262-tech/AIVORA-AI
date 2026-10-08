// OWNER: auth-security — the foundation ships this working in-memory baseline because route()
// now applies a default limit to every route. Keep the exports; harden or swap freely.
import 'server-only';

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

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Fixed-window counters in a Map. A key starts a window on its first hit and is blocked once it
 * has made more than `limit` hits before the window ends. Expired windows are dropped lazily (at
 * most once a minute, from inside `hit`), so there is no timer to keep the process alive.
 * State is per process: behind several instances each one enforces its own budget.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();
  private nextSweepAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Number of keys currently tracked (expired ones linger until the next sweep). */
  get size(): number {
    return this.windows.size;
  }

  hit(key: string, limit: number, windowSec: number): RateLimitResult {
    const now = this.now();
    this.sweep(now);
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowSec * 1000 };
      this.windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= limit,
      remaining: Math.max(0, limit - window.count),
      resetAt: window.resetAt,
    };
  }

  private sweep(now: number): void {
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + SWEEP_INTERVAL_MS;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

// Kept on globalThis so Next.js dev HMR (which re-evaluates modules) does not reset every budget.
const LIMITER_KEY = Symbol.for('aivore.rate-limiter');
type GlobalWithLimiter = typeof globalThis & { [LIMITER_KEY]?: RateLimiter };

/** The process-wide limiter (in-memory by default, swappable with {@link setRateLimiter}). */
export function getRateLimiter(): RateLimiter {
  const scope = globalThis as GlobalWithLimiter;
  return (scope[LIMITER_KEY] ??= new InMemoryRateLimiter());
}

/** Replaces the process-wide limiter (a shared store, or a fake in tests); `null` restores the default. */
export function setRateLimiter(limiter: RateLimiter | null): void {
  (globalThis as GlobalWithLimiter)[LIMITER_KEY] = limiter ?? undefined;
}
