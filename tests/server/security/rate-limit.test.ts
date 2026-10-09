import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import {
  InMemoryRateLimiter,
  getRateLimiter,
  setRateLimiter,
  unlimitedRateLimiter,
  type RateLimiter,
} from '@/server/security/rate-limit';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
  resetEnvForTests();
});

afterEach(() => {
  setRateLimiter(null);
  vi.unstubAllEnvs();
  resetEnvForTests();
});

function clock(start = 1_000_000) {
  const state = { now: start };
  return { state, read: () => state.now };
}

describe('InMemoryRateLimiter', () => {
  it('allows up to the limit, then blocks until the window ends', () => {
    const time = clock();
    const limiter = new InMemoryRateLimiter(time.read);
    const results = Array.from({ length: 4 }, () => limiter.hit('k', 3, 60));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results.map((result) => result.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]?.resetAt).toBe(1_000_000 + 60_000);
  });

  it('keeps counting rejected hits inside the window, so a flood does not shorten it', () => {
    const time = clock();
    const limiter = new InMemoryRateLimiter(time.read);
    for (let i = 0; i < 50; i += 1) limiter.hit('k', 2, 60);
    time.state.now += 59_999;
    expect(limiter.hit('k', 2, 60).allowed).toBe(false);
  });

  describe('release', () => {
    it('takes one hit back, so a request that did nothing does not use up the budget', () => {
      const limiter = new InMemoryRateLimiter(clock().read);
      const first = limiter.hit('k', 2, 60);
      limiter.release('k', first);
      expect(limiter.hit('k', 2, 60).remaining).toBe(1);
      const second = limiter.hit('k', 2, 60);
      expect(second.allowed).toBe(true);
      expect(limiter.hit('k', 2, 60).allowed).toBe(false);
      limiter.release('k', second);
      expect(limiter.hit('k', 2, 60).allowed).toBe(false); // the blocked hit above still counts
    });

    it('leaves a newer window alone: a hit from a finished window is not worth anything now', () => {
      const time = clock();
      const limiter = new InMemoryRateLimiter(time.read);
      const old = limiter.hit('k', 2, 10);
      time.state.now += 10_000;
      limiter.hit('k', 2, 10); // the first hit of the new window
      limiter.release('k', old);
      expect(limiter.hit('k', 2, 10).remaining).toBe(0); // both hits of the new window still count
    });

    it('never counts below zero, and ignores keys it does not know', () => {
      const limiter = new InMemoryRateLimiter(clock().read);
      const result = limiter.hit('k', 5, 60);
      limiter.release('k', result);
      limiter.release('k', result);
      limiter.release('unknown', result);
      expect(limiter.hit('k', 5, 60).remaining).toBe(4);
    });

    it('is a no-op for the pass-through limiter', () => {
      const result = unlimitedRateLimiter.hit('k', 3, 60);
      expect(() => unlimitedRateLimiter.release?.('k', result)).not.toThrow();
    });
  });

  it('starts a fresh window when the previous one has ended', () => {
    const time = clock();
    const limiter = new InMemoryRateLimiter(time.read);
    limiter.hit('k', 1, 10);
    expect(limiter.hit('k', 1, 10).allowed).toBe(false);
    time.state.now += 10_000;
    const next = limiter.hit('k', 1, 10);
    expect(next).toEqual({ allowed: true, remaining: 0, resetAt: time.state.now + 10_000 });
  });

  it('counts keys independently', () => {
    const limiter = new InMemoryRateLimiter(clock().read);
    expect(limiter.hit('general:ip:1.1.1.1', 1, 60).allowed).toBe(true);
    expect(limiter.hit('general:ip:1.1.1.1', 1, 60).allowed).toBe(false);
    expect(limiter.hit('general:ip:2.2.2.2', 1, 60).allowed).toBe(true);
    expect(limiter.hit('general:user:u1', 1, 60).allowed).toBe(true);
  });

  it('drops expired windows so memory does not grow with every address ever seen', () => {
    const time = clock();
    const limiter = new InMemoryRateLimiter(time.read);
    for (let i = 0; i < 1000; i += 1) limiter.hit(`ip:${i}`, 5, 30);
    expect(limiter.size).toBe(1000);
    time.state.now += 61_000; // past both the window and the sweep interval
    limiter.hit('fresh', 5, 30);
    expect(limiter.size).toBe(1);
  });

  it('keeps unexpired windows when it sweeps', () => {
    const time = clock();
    const limiter = new InMemoryRateLimiter(time.read);
    limiter.hit('hourly', 5, 3600);
    limiter.hit('short', 5, 10);
    time.state.now += 61_000;
    limiter.hit('trigger', 5, 10);
    expect(limiter.size).toBe(2);
    expect(limiter.hit('hourly', 5, 3600).remaining).toBe(3);
  });
});

describe('getRateLimiter', () => {
  it('is one process-wide instance', () => {
    expect(getRateLimiter()).toBe(getRateLimiter());
    expect(getRateLimiter()).toBeInstanceOf(InMemoryRateLimiter);
  });

  it('can be swapped for another store and restored', () => {
    const fake: RateLimiter = { hit: () => ({ allowed: false, remaining: 0, resetAt: 1 }) };
    setRateLimiter(fake);
    expect(getRateLimiter()).toBe(fake);
    setRateLimiter(null);
    expect(getRateLimiter()).not.toBe(fake);
    expect(getRateLimiter().hit('x', 1, 1).allowed).toBe(true);
  });
});

describe('InMemoryRateLimiter memory cap', () => {
  it('never tracks more than maxKeys, however many distinct keys arrive', () => {
    const limiter = new InMemoryRateLimiter(clock().read, { maxKeys: 100 });
    for (let i = 0; i < 10_000; i += 1) limiter.hit(`ip:${i}`, 5, 3600);
    expect(limiter.size).toBe(100);
  });

  it('evicts the least recently used key, not the oldest created one', () => {
    const limiter = new InMemoryRateLimiter(clock().read, { maxKeys: 3 });
    limiter.hit('a', 5, 60);
    limiter.hit('b', 5, 60);
    limiter.hit('c', 5, 60);
    limiter.hit('a', 5, 60); // a is now the most recently used
    limiter.hit('d', 5, 60); // evicts b
    expect(limiter.hit('a', 5, 60).remaining).toBe(2); // a kept its three hits
    expect(limiter.hit('c', 5, 60).remaining).toBe(3); // c kept its two
    expect(limiter.hit('b', 5, 60).remaining).toBe(4); // b was forgotten and starts over
  });

  it('keeps counting a client that keeps hitting while a flood of unique keys passes by', () => {
    const limiter = new InMemoryRateLimiter(clock().read, { maxKeys: 50 });
    let blocked = false;
    for (let i = 0; i < 2_000; i += 1) {
      limiter.hit(`flood:${i}`, 1, 60);
      if (i % 10 === 0 && !limiter.hit('attacker', 20, 60).allowed) blocked = true;
    }
    // 200 hits on a 20-per-window key while 2000 other keys cycle through a 50-key store.
    expect(blocked).toBe(true);
    expect(limiter.size).toBeLessThanOrEqual(50);
  });

  it('prefers dropping expired windows over live ones when it sweeps', () => {
    const time = clock();
    const limiter = new InMemoryRateLimiter(time.read, { maxKeys: 1000, sweepIntervalMs: 1000 });
    for (let i = 0; i < 500; i += 1) limiter.hit(`short:${i}`, 5, 1);
    limiter.hit('long', 5, 3600);
    time.state.now += 2000;
    limiter.hit('trigger', 5, 60);
    expect(limiter.size).toBe(2);
    expect(limiter.hit('long', 5, 3600).remaining).toBe(3);
  });

  it('accepts a degenerate maxKeys without breaking', () => {
    const limiter = new InMemoryRateLimiter(clock().read, { maxKeys: 0 });
    expect(limiter.hit('a', 1, 60).allowed).toBe(true);
    expect(limiter.size).toBe(1);
  });
});

describe('InMemoryRateLimiter window math', () => {
  it('resets exactly at resetAt, not a millisecond before', () => {
    const time = clock();
    const limiter = new InMemoryRateLimiter(time.read);
    limiter.hit('k', 1, 10);
    time.state.now += 9_999;
    expect(limiter.hit('k', 1, 10).allowed).toBe(false);
    time.state.now += 1;
    expect(limiter.hit('k', 1, 10).allowed).toBe(true);
  });

  it('recovers when the clock steps backwards instead of blocking for hours', () => {
    const time = clock(10_000_000);
    const limiter = new InMemoryRateLimiter(time.read);
    limiter.hit('k', 1, 60);
    expect(limiter.hit('k', 1, 60).allowed).toBe(false);
    time.state.now -= 3_600_000; // NTP steps the clock back an hour
    const result = limiter.hit('k', 1, 60);
    expect(result.allowed).toBe(true);
    expect(result.resetAt).toBe(time.state.now + 60_000);
  });

  it('reports remaining 0 and allowed false past the limit, never negative', () => {
    const limiter = new InMemoryRateLimiter(clock().read);
    const results = Array.from({ length: 5 }, () => limiter.hit('k', 2, 60));
    expect(results.map((r) => r.remaining)).toEqual([1, 0, 0, 0, 0]);
    expect(results.map((r) => r.allowed)).toEqual([true, true, false, false, false]);
  });

  it('tolerates a window shorter than a second', () => {
    const limiter = new InMemoryRateLimiter(clock().read);
    expect(limiter.hit('k', 1, 0).resetAt).toBeGreaterThan(0);
  });
});

describe('RATE_LIMIT_DISABLED', () => {
  it('is off by default', () => {
    expect(getRateLimiter()).toBeInstanceOf(InMemoryRateLimiter);
    expect(getRateLimiter().hit('k', 1, 60).allowed).toBe(true);
    expect(getRateLimiter().hit('k', 1, 60).allowed).toBe(false);
  });

  it('lets everything through when set, with sane header numbers', () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetEnvForTests();
    expect(getRateLimiter()).toBe(unlimitedRateLimiter);
    for (let i = 0; i < 1000; i += 1) {
      const result = getRateLimiter().hit('k', 1, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    }
  });

  it('returns to real limiting when the variable goes away', () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetEnvForTests();
    expect(getRateLimiter()).toBe(unlimitedRateLimiter);
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    resetEnvForTests();
    expect(getRateLimiter()).toBeInstanceOf(InMemoryRateLimiter);
  });

  it('never overrides a limiter installed explicitly', () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetEnvForTests();
    const strict: RateLimiter = { hit: () => ({ allowed: false, remaining: 0, resetAt: 1 }) };
    setRateLimiter(strict);
    expect(getRateLimiter()).toBe(strict);
  });

  it('logs a loud warning once at start-up', async () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    vi.stubEnv('LOG_LEVEL', 'warn');
    resetEnvForTests();
    const { getEnv } = await import('@/server/env');
    const { resetLoggerForTests } = await import('@/server/logger');
    resetLoggerForTests();
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    getEnv();
    getEnv();
    const lines = write.mock.calls.map(
      ([chunk]) => JSON.parse(String(chunk)) as { level: string; msg: string },
    );
    const warning = lines.filter((line) => line.msg.includes('RATE_LIMIT_DISABLED'));
    expect(warning).toHaveLength(1);
    expect(warning[0]).toMatchObject({ level: 'warn', msg: expect.stringContaining('OFF') });
    resetLoggerForTests();
  });
});
