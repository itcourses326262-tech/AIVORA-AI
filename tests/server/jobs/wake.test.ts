import { describe, expect, it, vi } from 'vitest';
import { onWake, wakeWorkers } from '@/server/jobs/wake';

describe('wake registry', () => {
  it('calls every registered listener', () => {
    const [a, b] = [vi.fn(), vi.fn()];
    const offA = onWake(a);
    const offB = onWake(b);
    wakeWorkers();
    expect([a, b].map((listener) => listener.mock.calls.length)).toEqual([1, 1]);
    offA();
    offB();
  });

  it('stops calling a listener that was removed, and removing twice is fine', () => {
    const listener = vi.fn();
    const off = onWake(listener);
    off();
    off();
    wakeWorkers();
    expect(listener).not.toHaveBeenCalled();
  });

  it('does nothing without listeners', () => {
    expect(() => wakeWorkers()).not.toThrow();
  });

  it('keeps calling the others when one listener throws', () => {
    const after = vi.fn();
    const offBroken = onWake(() => {
      throw new Error('broken listener');
    });
    const offAfter = onWake(after);
    expect(() => wakeWorkers()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    offBroken();
    offAfter();
  });

  it('is shared between separately loaded copies of the module (HMR, separate bundles)', async () => {
    const listener = vi.fn();
    const off = onWake(listener);
    vi.resetModules();
    const fresh = await import('@/server/jobs/wake');
    fresh.wakeWorkers();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});
