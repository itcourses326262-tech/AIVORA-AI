// OWNER: engine — real wiring (the behaviour lives in runner.ts)
import 'server-only';
import type { JobRunner } from './runner';
import { createJobRunner } from './worker';

// On globalThis so Next.js dev HMR and the separately bundled instrumentation entry share one runner.
const RUNNER_KEY = Symbol.for('aivore.jobRunner');
const EXIT_HOOK_KEY = Symbol.for('aivore.jobRunnerExitHook');
type GlobalWithRunner = typeof globalThis & {
  [RUNNER_KEY]?: JobRunner;
  [EXIT_HOOK_KEY]?: () => void;
};

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

  // The web server owns the process, so it decides when it ends. Whichever way it does (SIGTERM,
  // Ctrl-C, a deploy), hand the running jobs back on the way out so they resume at once.
  const onExit = () => {
    try {
      runner.abandon();
    } catch {
      // The database may already be closed; the leases expire on their own.
    }
  };
  scope[EXIT_HOOK_KEY] = onExit;
  process.once('exit', onExit);
  return runner;
}

/** Stops the runner started by {@link startWorker}, if any. */
export async function stopWorker(): Promise<void> {
  const scope = globalThis as GlobalWithRunner;
  const runner = scope[RUNNER_KEY];
  scope[RUNNER_KEY] = undefined;
  const onExit = scope[EXIT_HOOK_KEY];
  scope[EXIT_HOOK_KEY] = undefined;
  if (onExit) process.removeListener('exit', onExit);
  await runner?.stop();
}
