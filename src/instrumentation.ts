/**
 * Runs once when the Next.js server starts. In `WORKER_MODE=inline` it starts the job runner inside
 * this process. Failing to start the runner must never stop the app from booting, so errors are
 * logged and swallowed: pages and the API keep working. A runner that fails to start is tried
 * again with a growing pause (see `startWorkerWithRetry`), so a transient error at boot does not
 * leave generations queued until the next restart.
 *
 * One failure is not swallowed: storage that cannot be created (with `STORAGE_DRIVER=gcs`, a
 * service-account file that is missing, unreadable or malformed). That is not transient and nothing
 * works without it: uploads fail, pictures are not found, and generations are accepted and paid for
 * but never run. It is checked before anything is started. In production the process then ends with
 * the one-line error (`next start` and the standalone `server.js` both survive a `register` that
 * throws and answer 500 everywhere, which a container supervisor reads as "up"); in development
 * `register` throws, so that every request fails with the error instead of a site that half works.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const problem = await storageProblemAtBoot();
  if (problem) {
    if (process.env.NODE_ENV === 'production') process.exit(1);
    throw new Error(problem);
  }

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

/** The reason the configured storage cannot be used, logged once; null when it can be. */
async function storageProblemAtBoot(): Promise<string | null> {
  try {
    const { storageProblem } = await import('@/server/storage');
    const problem = storageProblem();
    if (problem) {
      try {
        (await import('@/server/logger')).getLogger().error(problem);
      } catch {
        console.error(problem);
      }
    }
    return problem;
  } catch {
    // An invalid environment: reported, as it always was, by the start-up code below.
    return null;
  }
}
