import { afterEach, describe, expect, it } from 'vitest';
import {
  InMemoryRateLimiter,
  getRateLimiter,
  setRateLimiter,
  type RateLimiter,
} from '@/server/security/rate-limit';

afterEach(() => setRateLimiter(null));

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
