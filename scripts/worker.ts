import { closeDb } from '@/server/db';
import { getEnv } from '@/server/env';
import { createJobRunner } from '@/server/jobs/worker';
import { getLogger } from '@/server/logger';

// `npm run worker`: the job runner as its own process (WORKER_MODE=external on the web app).
// SIGTERM and SIGINT stop it gracefully: it stops claiming, lets running jobs finish for a few
// seconds and hands the rest back to the queue, where whichever runner claims them next resumes
// them. A second signal, or a crash, ends the process at once.
const log = getLogger();

async function main(): Promise<void> {
  const env = getEnv();
  const runner = createJobRunner();
  runner.start();
  log.info('Worker started', { workerId: runner.workerId, concurrency: env.WORKER_CONCURRENCY });
  if (env.WORKER_MODE === 'inline') {
    log.warn(
      'WORKER_MODE=inline: the web server also runs jobs. Set WORKER_MODE=external there to run them only here.',
    );
  }

  let stopping = false;
  const shutdown = (reason: string, exitCode: number) => {
    if (stopping) {
      log.warn('Second stop request; exiting without waiting', { reason });
      process.exit(1);
    }
    stopping = true;
    log.info('Worker stopping', { reason });
    runner
      .stop()
      .catch((error: unknown) => {
        log.error('Worker failed to stop cleanly', { err: error });
        exitCode = 1;
      })
      .finally(() => {
        closeDb();
        process.exit(exitCode);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('SIGINT', () => shutdown('SIGINT', 0));
  // A bug must not leave a half-working worker holding leases: stop cleanly and let the
  // supervisor (Docker, systemd) restart it.
  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception in the worker', { err: error });
    shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (error) => {
    log.error('Unhandled rejection in the worker', { err: error });
    shutdown('unhandledRejection', 1);
  });
}

main().catch((error: unknown) => {
  log.error('Worker failed to start', { err: error });
  closeDb();
  process.exitCode = 1;
});
