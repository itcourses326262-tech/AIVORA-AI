/**
 * Runs once when the Next.js server starts. In `WORKER_MODE=inline` it starts the job runner inside
 * this process. Failing to start the runner must never stop the app from booting, so errors are
 * logged and swallowed: pages and the API keep working, generations just stay queued.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { getLogger } = await import('@/server/logger');
    const log = getLogger();
    try {
      const { getEnv } = await import('@/server/env');
      if (getEnv().WORKER_MODE !== 'inline') return;
      const { startWorker } = await import('@/server/jobs/start');
      const runner = startWorker();
      log.info('Inline job runner started', { workerId: runner.workerId });
    } catch (error) {
      log.error('Inline job runner failed to start; generations will stay queued', { err: error });
    }
  } catch (error) {
    // Not even the logger could be loaded; the app still has to come up.
    console.error('Instrumentation failed; the inline job runner is not running', error);
  }
}
