import type { TimeWarp } from './time-warp';

export interface Freezable {
  /** A runner `sleep` that never returns until `thaw()`, then behaves like the warped clock. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Lets a frozen worker continue, as a process that was stopped and is running again. */
  thaw(): void;
}

/**
 * Stands in for a worker process that froze (a stopped container, a long pause, a partition): a
 * runner built with this `sleep` claims and starts its job, then never gets past its first wait,
 * so its heartbeat never runs and its lease runs out. Nothing is faked on the engine's side.
 */
export function freezable(time: TimeWarp): Freezable {
  let thawed = false;
  const waiting = new Set<() => void>();

  return {
    sleep(ms, signal) {
      if (thawed) return time.sleep(ms, signal);
      return new Promise<void>((resolve, reject) => {
        const release = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          waiting.delete(release);
          reject(signal?.reason);
        };
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        waiting.add(release);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    thaw() {
      thawed = true;
      for (const release of waiting) release();
      waiting.clear();
    },
  };
}
