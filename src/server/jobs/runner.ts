// OWNER: engine — replace this stub
import 'server-only';
import type { ProviderId } from '@/lib/catalog/types';
import { NotImplementedError } from '@/lib/errors';
import type { Db } from '@/server/db';
import type { Env } from '@/server/env';
import type { Logger } from '@/server/logger';
import type { GenerationProvider } from '@/server/providers/types';
import type { StorageDriver } from '@/server/storage/types';

export interface JobRunnerDeps {
  db: Db;
  storage: StorageDriver;
  providers: { getProvider(id: ProviderId): GenerationProvider };
  env: Env;
  log: Logger;
  /** Clock for leases and backoff; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Claims queued generations and drives them through submit, poll and persist (section 6.6). One
 * instance per process; `WORKER_CONCURRENCY` jobs run at a time.
 */
export class JobRunner {
  /** Identifies this runner in `generations.workerId`. */
  readonly workerId: string = `worker-${process.pid}`;

  constructor(readonly deps: JobRunnerDeps) {}

  /** Starts the claim loop and returns immediately. Idempotent. */
  start(): void {
    throw new NotImplementedError('jobs.JobRunner.start');
  }

  /** Stops claiming, lets running jobs finish or hand back their lease, and resolves when idle. */
  async stop(): Promise<void> {
    throw new NotImplementedError('jobs.JobRunner.stop');
  }

  /** Nudges the loop to look for work now instead of at the next poll interval. */
  wake(): void {
    throw new NotImplementedError('jobs.JobRunner.wake');
  }

  /** One claim-and-process pass. Resolves with the number of jobs it finished. For tests and `wake`. */
  async tick(): Promise<number> {
    throw new NotImplementedError('jobs.JobRunner.tick');
  }
}
