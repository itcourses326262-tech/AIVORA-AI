import 'server-only';

// A runner registers itself here when it starts; the generation service calls `wakeWorkers()` after
// it commits a new job. Kept on globalThis because the instrumentation entry and the route bundles
// may load this module separately, and they must still see the same runner. When no runner lives in
// this process (WORKER_MODE=external or off) the call does nothing and the worker finds the job on
// its next idle poll.
const WAKE_KEY = Symbol.for('aivore.jobWake');
type GlobalWithWake = typeof globalThis & { [WAKE_KEY]?: Set<() => void> };

function listeners(): Set<() => void> {
  const scope = globalThis as GlobalWithWake;
  return (scope[WAKE_KEY] ??= new Set());
}

/** Registers `listener` to be called by {@link wakeWorkers}; returns the function that removes it. */
export function onWake(listener: () => void): () => void {
  const all = listeners();
  all.add(listener);
  return () => {
    all.delete(listener);
  };
}

/** Tells the runners in this process that a job was queued. Never throws. */
export function wakeWorkers(): void {
  for (const listener of listeners()) {
    try {
      listener();
    } catch {
      // A broken listener must not turn a committed generation into a failed request.
    }
  }
}
