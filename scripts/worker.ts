// OWNER: engine — wiring in place; JobRunner (src/server/jobs/runner.ts) is still a stub
import { closeDb } from '@/server/db';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';
import { createJobRunner } from '@/server/jobs/worker';

// `npm run worker`: the job runner as its own process (WORKER_MODE=external). SIGTERM and SIGINT
// stop it gracefully; a job interrupted mid-flight is resumed by whichever runner claims it next.
const log = getLogger();

async function main(): Promise<void> {
  const env = getEnv();
  const runner = createJobRunner();
  runner.start();
  log.info('Worker started', { workerId: runner.workerId, concurrency: env.WORKER_CONCURRENCY });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    log.info('Worker stopping', { signal });
    runner
      .stop()
      .catch((error: unknown) => log.error('Worker failed to stop cleanly', { err: error }))
      .finally(() => {
        closeDb();
        process.exit(process.exitCode ?? 0);
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  log.error('Worker failed to start', { err: error });
  closeDb();
  process.exitCode = 1;
});
