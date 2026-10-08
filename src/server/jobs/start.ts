// OWNER: engine — real wiring (the behaviour lives in runner.ts)
import 'server-only';
import type { Logger } from '@/server/logger';
import type { JobRunner } from './runner';
import { createJobRunner } from './worker';

// On globalThis so Next.js dev HMR and the separately bundled instrumentation entry share one runner.
const RUNNER_KEY = Symbol.for('aivore.jobRunner');
const EXIT_HOOK_KEY = Symbol.for('aivore.jobRunnerExitHook');
const RETRY_KEY = Symbol.for('aivore.jobRunnerRetry');
type GlobalWithRunner = typeof globalThis & {
  [RUNNER_KEY]?: JobRunner;
  [EXIT_HOOK_KEY]?: () => void;
  [RETRY_KEY]?: ReturnType<typeof setTimeout>;
};

/** Pause before the first retry; it doubles each time. */
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 30_000;

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

/** Whether this process has a running job runner. */
export function isWorkerRunning(): boolean {
  return (globalThis as GlobalWithRunner)[RUNNER_KEY] !== undefined;
}

/**
 * {@link startWorker} for a server that has to come up whatever happens: a failure is logged and
 * tried again after 1 s, 2 s, 4 s ... (30 s at most) until it works or {@link stopWorker} is called.
 * One transient error at boot (the database busy while another process migrates it) must not leave
 * an app that accepts and bills generations nothing will ever run. Returns the runner when the
 * first try worked, otherwise undefined; later calls while a retry is pending do nothing.
 */
export function startWorkerWithRetry(log: Logger): JobRunner | undefined {
  const scope = globalThis as GlobalWithRunner;
  if (scope[RETRY_KEY] !== undefined) return undefined;
  const attempt = (number: number): JobRunner | undefined => {
    try {
      return startWorker();
    } catch (error) {
      const delayMs = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (number - 1));
      log.error('Inline job runner failed to start; generations stay queued until it does', {
        err: error,
        attempt: number,
        retryInMs: delayMs,
      });
      const timer = setTimeout(() => {
        scope[RETRY_KEY] = undefined;
        const runner = attempt(number + 1);
        if (runner)
          log.info('Inline job runner started', { workerId: runner.workerId, attempt: number + 1 });
      }, delayMs);
      timer.unref(); // never the reason the process stays alive
      scope[RETRY_KEY] = timer;
      return undefined;
    }
  };
  return attempt(1);
}

/** Stops the runner started by {@link startWorker}, if any, and cancels a pending start retry. */
export async function stopWorker(): Promise<void> {
  const scope = globalThis as GlobalWithRunner;
  const retry = scope[RETRY_KEY];
  scope[RETRY_KEY] = undefined;
  if (retry !== undefined) clearTimeout(retry);
  const runner = scope[RUNNER_KEY];
  scope[RUNNER_KEY] = undefined;
  const onExit = scope[EXIT_HOOK_KEY];
  scope[EXIT_HOOK_KEY] = undefined;
  if (onExit) process.removeListener('exit', onExit);
  await runner?.stop();
}
