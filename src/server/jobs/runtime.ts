import 'server-only';
import type { ProviderId } from '@/lib/catalog/types';
import type { Db } from '@/server/db';
import type { Env } from '@/server/env';
import type { Logger } from '@/server/logger';
import type { GenerationProvider } from '@/server/providers/types';
import type { safeFetch } from '@/server/security/ssrf';
import type { StorageDriver } from '@/server/storage/types';
import type { persistOutput } from '@/server/uploads';

/** Timing knobs. The defaults are right for production; tests shrink or stretch them. */
export interface RunnerTuning {
  /** How long a claim lasts without a heartbeat before another worker may take the job over. */
  leaseMs: number;
  /** How often a running job pushes its lease out (the lease must be several times longer). */
  heartbeatMs: number;
  /** How long the loop sleeps when there is nothing to claim, unless `wake()` cuts it short. */
  idleMs: number;
  /** How long `stop()` lets running jobs finish before it hands them back to the queue. */
  shutdownGraceMs: number;
  /** Consecutive failed polls (retryable provider errors) a job tolerates before it fails. */
  maxPollErrors: number;
}

export const DEFAULT_TUNING: Readonly<RunnerTuning> = {
  leaseMs: 60_000,
  heartbeatMs: 15_000,
  idleMs: 1_000,
  shutdownGraceMs: 8_000,
  maxPollErrors: 5,
};

/** Everything one running job needs, resolved once by the runner. */
export interface JobRuntime {
  db: Db;
  storage: StorageDriver;
  providers: { getProvider(id: ProviderId): GenerationProvider };
  env: Env;
  log: Logger;
  /** The identity of THIS claim, as written to `generations.workerId` (see `JobRunner.workerId`). */
  workerId: string;
  tuning: RunnerTuning;
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  random(): number;
  /** Handed to providers as `ctx.fetch`. */
  fetch: typeof fetch;
  /** Downloads provider output URLs. Always the SSRF-safe fetch outside tests. */
  fetchOutput: typeof safeFetch;
  persistOutput: typeof persistOutput;
  /** Aborts when the runner is stopping and has run out of patience. */
  shutdown: AbortSignal;
}
