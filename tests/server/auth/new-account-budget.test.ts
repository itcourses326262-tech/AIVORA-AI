import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { newAccountBudget } from '@/server/auth/new-account-budget';
import { InMemoryRateLimiter, setRateLimiter } from '@/server/security/rate-limit';

const OPTIONS = { name: 'test-signups', limit: 3, windowSec: 3600, by: 'ip' as const };
const KEY = 'test-signups:ip:unknown';

let limiter: InMemoryRateLimiter;
beforeEach(() => {
  limiter = new InMemoryRateLimiter();
  setRateLimiter(limiter);
});
afterEach(() => setRateLimiter(null));

/** How many hits the bucket holds, without spending one. */
function used(): number {
  const probe = limiter.hit(KEY, 1000, 3600);
  limiter.release(KEY, probe);
  return 1000 - probe.remaining - 1;
}

describe('newAccountBudget', () => {
  it('spends a hit per admitted account and keeps it when the account was created', () => {
    const budget = newAccountBudget(OPTIONS, 'ip:unknown');
    budget.admit();
    budget.settle(true);
    expect(used()).toBe(1);
  });

  it('gives the hit back when no account came out of the sign-in', () => {
    const budget = newAccountBudget(OPTIONS, 'ip:unknown');
    budget.admit();
    expect(used()).toBe(1);
    budget.settle(false);
    expect(used()).toBe(0);
  });

  it('spends nothing when nothing was admitted (a returning person), and settling is harmless', () => {
    const budget = newAccountBudget(OPTIONS, 'ip:unknown');
    budget.settle(false);
    budget.settle(true);
    expect(used()).toBe(0);
  });

  it('keeps exactly one hit when a retried transaction admitted twice', () => {
    const budget = newAccountBudget(OPTIONS, 'ip:unknown');
    budget.admit();
    budget.admit();
    budget.settle(true);
    expect(used()).toBe(1);
  });

  it('refuses with rate_limited and the wait once the budget is gone, and keeps that hit', () => {
    for (let index = 0; index < 3; index += 1) {
      const budget = newAccountBudget(OPTIONS, 'ip:unknown');
      budget.admit();
      budget.settle(true);
    }
    const refused = newAccountBudget(OPTIONS, 'ip:unknown');
    let error: unknown;
    try {
      refused.admit();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('rate_limited');
    expect((error as AppError).details).toMatchObject({ retryAfterSec: expect.any(Number) });
    expect(
      ((error as AppError).details as { retryAfterSec: number }).retryAfterSec,
    ).toBeGreaterThan(3000);
    // The refused hit was never held, so settling cannot give it back: hammering does not help.
    refused.settle(false);
    expect(used()).toBe(4);
  });

  it('counts per bucket name and scope', () => {
    const other = newAccountBudget({ ...OPTIONS, name: 'other' }, 'ip:unknown');
    other.admit();
    other.settle(true);
    expect(used()).toBe(0);
  });
});
