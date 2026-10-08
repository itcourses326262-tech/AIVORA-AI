import { vi } from 'vitest';

export interface TimeWarp {
  /** The warped clock in epoch ms: the same value `Date.now()` returns while it is installed. */
  now(): number;
  /** A runner `sleep`: waits `ms` of warped time, rejects with the signal's reason on abort. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Jumps the clock forward without waiting, e.g. to expire a lease or a session. */
  skip(ms: number): void;
  /** Puts the real `Date.now` back. */
  restore(): void;
}

/**
 * Makes time run `factor` times faster for everything that reads `Date.now()` (the Demo provider's
 * job clock, leases, sessions, rate-limit windows) and for the runner's sleeps, so a Demo image
 * that "takes" 4 s takes 0.4 s and the job loop stays real.
 *
 * Real work (sharp, GIF encoding) still takes real time, which the clock counts at `factor`, so
 * heartbeats and deadlines behave as in production instead of racing ahead of the work, which is
 * what a fully virtual clock would do.
 */
export function installTimeWarp(factor: number): TimeWarp {
  const realNow = Date.now.bind(Date);
  const origin = realNow();
  let skipped = 0;
  const now = () => origin + (realNow() - origin) * factor + skipped;
  const spy = vi.spyOn(Date, 'now').mockImplementation(now);

  return {
    now,
    restore: () => spy.mockRestore(),
    skip(ms) {
      skipped += ms;
    },
    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal?.reason);
        };
        const timer = setTimeout(
          () => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          },
          Math.max(0, ms) / factor,
        );
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}
