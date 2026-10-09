import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { runBulk } from '@/components/gallery/bulk';

const instant = () => Promise.resolve();

describe('runBulk', () => {
  it('runs the action for every id and reports who succeeded', async () => {
    const action = vi.fn(async () => {});
    const result = await runBulk(['a', 'b', 'c'], action, { wait: instant });
    expect(action).toHaveBeenCalledTimes(3);
    expect(result.succeeded.sort()).toEqual(['a', 'b', 'c']);
    expect(result.failed).toEqual([]);
  });

  it('does nothing for an empty list', async () => {
    const action = vi.fn(async () => {});
    await expect(runBulk([], action)).resolves.toEqual({ succeeded: [], failed: [] });
    expect(action).not.toHaveBeenCalled();
  });

  it('keeps going when one fails and reports the failure with its error', async () => {
    const boom = new ApiError('internal', 500, 'boom');
    const result = await runBulk(
      ['a', 'b', 'c'],
      async (id) => {
        if (id === 'b') throw boom;
      },
      { wait: instant },
    );
    expect(result.succeeded.sort()).toEqual(['a', 'c']);
    expect(result.failed).toEqual([{ id: 'b', error: boom }]);
  });

  it('never has more requests in flight than the concurrency allows', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBulk(
      Array.from({ length: 10 }, (_, i) => String(i)),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
      },
      { concurrency: 3, wait: instant },
    );
    expect(peak).toBe(3);
  });

  it('waits and tries again after a 429 instead of failing, honouring Retry-After', async () => {
    const waits: number[] = [];
    const waiting: boolean[] = [];
    let calls = 0;
    const result = await runBulk(
      ['a'],
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new ApiError('rate_limited', 429, 'slow down', { retryAfterSec: 7 });
        }
      },
      {
        wait: async (ms) => {
          waits.push(ms);
        },
        onWaiting: (value) => waiting.push(value),
      },
    );
    expect(result.succeeded).toEqual(['a']);
    expect(calls).toBe(3);
    expect(waits).toEqual([7000, 7000]);
    expect(waiting).toEqual([true, false, true, false]);
  });

  it('gives up on a creation that stays rate limited, after the allowed number of tries', async () => {
    const action = vi.fn(async () => {
      throw new ApiError('rate_limited', 429, 'slow down');
    });
    const result = await runBulk(['a', 'b'], action, {
      maxRateLimitRetries: 2,
      concurrency: 1,
      wait: instant,
    });
    expect(result.succeeded).toEqual([]);
    expect(result.failed.map((failure) => failure.id)).toEqual(['a', 'b']);
    expect(action).toHaveBeenCalledTimes(6);
  });

  it('does not retry any other error', async () => {
    const action = vi.fn(async () => {
      throw new ApiError('forbidden', 403, 'no');
    });
    const result = await runBulk(['a'], action, { wait: instant });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.failed).toHaveLength(1);
  });

  it('reports progress after every creation', async () => {
    const progress: Array<[number, number]> = [];
    await runBulk(['a', 'b', 'c'], async () => {}, {
      concurrency: 1,
      wait: instant,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});
