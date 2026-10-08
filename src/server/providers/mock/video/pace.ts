import 'server-only';

// Captured when the module loads so that test suites using fake timers cannot stall a render.
const realSetImmediate = globalThis.setImmediate;

/** Lets pending I/O (HTTP requests, the job loop's heartbeat) run between two heavy frames. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => realSetImmediate(resolve));
}

/** Frame count of a clip: ten frames per second, never more than thirty (the GIF stays small). */
export const MAX_FRAMES = 30;
const MIN_FRAMES = 12;

export function frameCountFor(durationSec: number): number {
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(durationSec * 10)));
}
