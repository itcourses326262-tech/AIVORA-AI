/**
 * Runs once when the Next.js server starts. In `WORKER_MODE=inline` it starts the job runner inside
 * this process. Failing to start the runner must never stop the app from booting, so errors are
 * logged and swallowed: pages and the API keep working. A runner that fails to start is tried
 * again with a growing pause (see `startWorkerWithRetry`), so a transient error at boot does not
 * leave generations queued until the next restart.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { getLogger } = await import('@/server/logger');
    const log = getLogger();
    try {
      const { getEnv } = await import('@/server/env');
      try {
        // Billing's own background work (renewal links, payment reconciliation); independent of the runner.
        const { bootBillingScheduler } = await import('@/server/billing/boot');
        bootBillingScheduler(log);
      } catch (error) {
        log.error('Billing scheduler failed to start; renewals wait until it does', { err: error });
      }
      if (getEnv().WORKER_MODE !== 'off') {
        try {
          // Finishes the erasure of deleted accounts whose files could not all be removed at the time.
          const { startAccountPurgeScheduler } = await import('@/server/auth/purge-scheduler');
          startAccountPurgeScheduler(log);
        } catch (error) {
          log.error('Deleted-account sweeper failed to start; run `admin purge-deleted` by hand', {
            err: error,
          });
        }
      }
      if (getEnv().WORKER_MODE !== 'inline') return;
      const { startWorkerWithRetry } = await import('@/server/jobs/start');
      const runner = startWorkerWithRetry(log);
      if (runner) log.info('Inline job runner started', { workerId: runner.workerId });
    } catch (error) {
      log.error('Inline job runner failed to start; generations will stay queued', { err: error });
    }
  } catch (error) {
    // Not even the logger could be loaded; the app still has to come up.
    console.error('Instrumentation failed; the inline job runner is not running', error);
  }
}
