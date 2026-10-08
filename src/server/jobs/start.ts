// OWNER: engine — real wiring (the behaviour lives in runner.ts)
import 'server-only';
import type { JobRunner } from './runner';
import { createJobRunner } from './worker';

// On globalThis so Next.js dev HMR and the separately bundled instrumentation entry share one runner.
const RUNNER_KEY = Symbol.for('aivore.jobRunner');
type GlobalWithRunner = typeof globalThis & { [RUNNER_KEY]?: JobRunner };

/**
 * Starts this process's job runner once and returns it; later calls return the same instance.
 * Throws if the runner cannot start (the caller decides whether that is fatal).
 */
export function startWorker(): JobRunner {
  const scope = globalThis as GlobalWithRunner;
  const existing = scope[RUNNER_KEY];
  if (existing) return existing;
  const runner = createJobRunner();
  runner.start();
  scope[RUNNER_KEY] = runner;
  return runner;
}

/** Stops the runner started by {@link startWorker}, if any. */
export async function stopWorker(): Promise<void> {
  const scope = globalThis as GlobalWithRunner;
  const runner = scope[RUNNER_KEY];
  scope[RUNNER_KEY] = undefined;
  await runner?.stop();
}
