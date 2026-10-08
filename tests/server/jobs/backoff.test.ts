import { describe, expect, it } from 'vitest';
import { createPollBackoff, retryDelayMs } from '@/server/jobs/backoff';

const steady = () => 0.5;

function take(next: () => number, count: number): number[] {
  return Array.from({ length: count }, next);
}

describe('createPollBackoff', () => {
  it('grows an image wait from 1 s to 3 s', () => {
    const backoff = createPollBackoff('image', steady);
    expect(take(backoff.next, 7)).toEqual([1000, 1500, 2250, 3000, 3000, 3000, 3000]);
  });

  it('grows a video wait from 3 s to 10 s', () => {
    const backoff = createPollBackoff('video', steady);
    expect(take(backoff.next, 7)).toEqual([3000, 4500, 6750, 10_000, 10_000, 10_000, 10_000]);
  });

  it('spreads every wait by at most 20 percent either way', () => {
    for (const kind of ['image', 'video'] as const) {
      const low = take(createPollBackoff(kind, () => 0).next, 8);
      const high = take(createPollBackoff(kind, () => 0.999999).next, 8);
      const plain = take(createPollBackoff(kind, steady).next, 8);
      plain.forEach((base, index) => {
        expect(low[index]).toBe(Math.round(base * 0.8));
        expect(high[index]).toBe(Math.round(base * 1.2));
      });
    }
  });

  it('uses the random source it is given, once per wait', () => {
    const draws: number[] = [];
    const backoff = createPollBackoff('image', () => {
      draws.push(draws.length);
      return 0.5;
    });
    take(backoff.next, 3);
    expect(draws).toHaveLength(3);
  });

  it('gives each job its own schedule', () => {
    const first = createPollBackoff('image', steady);
    take(first.next, 5);
    expect(createPollBackoff('image', steady).next()).toBe(1000);
  });
});

describe('retryDelayMs', () => {
  it('doubles from 2 s up to a 30 s cap', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((attempt) => retryDelayMs(attempt, steady))).toEqual([
      2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it('jitters by at most 20 percent', () => {
    expect(retryDelayMs(1, () => 0)).toBe(1600);
    expect(retryDelayMs(1, () => 0.999999)).toBe(2400);
  });

  it('waits at least as long as the provider asked, but not more than a minute', () => {
    expect(retryDelayMs(1, steady, 20_000)).toBe(20_000);
    expect(retryDelayMs(1, steady, 500)).toBe(2000);
    expect(retryDelayMs(1, steady, 3_600_000)).toBe(60_000);
  });

  it('treats nonsense attempt numbers as the first', () => {
    expect(retryDelayMs(0, steady)).toBe(2000);
    expect(retryDelayMs(-4, steady)).toBe(2000);
  });
});
