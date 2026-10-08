import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ProviderId } from '@/lib/catalog/types';
import { sleep as realSleep } from '@/lib/utils';
import type { Db } from '@/server/db';
import type { Env } from '@/server/env';
import { claimNextJob, releaseWorkerJobs, requeueStale } from '@/server/generations/lifecycle';
import type { Logger } from '@/server/logger';
import type { GenerationProvider } from '@/server/providers/types';
import { safeFetch } from '@/server/security/ssrf';
import type { StorageDriver } from '@/server/storage/types';
import { persistOutput } from '@/server/uploads';
import { processJob } from './job-run';
import { DEFAULT_TUNING, type JobRuntime, type RunnerTuning } from './runtime';
import { onWake } from './wake';

export type { RunnerTuning } from './runtime';

export interface JobRunnerDeps {
  db: Db;
  storage: StorageDriver;
  providers: { getProvider(id: ProviderId): GenerationProvider };
  env: Env;
  log: Logger;
  /** Clock for leases and deadlines; defaults to `Date.now`. */
  now?: () => number;
  /** Waits for `ms` and rejects when `signal` aborts; defaults to a timer. Tests inject a fake clock. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Jitter source in `[0, 1)`; defaults to `Math.random`. */
  random?: () => number;
  /** What providers get as `ctx.fetch`; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Downloads provider output URLs; defaults to the SSRF-safe `safeFetch`. */
  fetchOutput?: typeof safeFetch;
  /** Stores an output; defaults to the storage module's `persistOutput`. */
  persistOutput?: typeof persistOutput;
  tuning?: Partial<RunnerTuning>;
}

interface RunningJob {
  /** The `workerId` this claim wrote to the row. */
  claimId: string;
  finished: Promise<void>;
}

/**
 * Claims queued generations and drives them through submit, poll and persist (section 6.6). One
 * instance per process; `WORKER_CONCURRENCY` jobs run at a time. Several runners (even in several
 * processes) can share one database: claiming is a compare-and-set, and a job whose worker
 * disappears is picked up again once its lease runs out.
 */
export class JobRunner {
  /**
   * Identifies this runner in logs; unique per runner, not just per process. What a claim writes
   * to `generations.workerId` is `<workerId>/<n>`: one identity per claim, so a run that lost its
   * job (and whatever it left hanging in the background) can never act on a later claim of the
   * same job, not even one made by this same runner.
   */
  readonly workerId: string = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

  /** The jobs this runner is running, by generation id. */
  private readonly running = new Map<string, RunningJob>();
  private claims = 0;
  private readonly tuning: RunnerTuning;
  private loop: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private stopRequested = false;
  private shutdown = new AbortController();
  private idle: AbortController | undefined;
  private wakePending = false;
  private unregisterWake: (() => void) | undefined;

  constructor(readonly deps: JobRunnerDeps) {
    this.tuning = { ...DEFAULT_TUNING, ...deps.tuning };
  }

  /** Starts the claim loop and returns immediately. Idempotent. */
  start(): void {
    if (this.loop || this.stopping) return;
    this.stopRequested = false;
    this.unregisterWake = onWake(() => this.wake());
    this.loop = this.runLoop();
    this.deps.log.info('Job runner started', {
      workerId: this.workerId,
      concurrency: this.deps.env.WORKER_CONCURRENCY,
    });
  }

  /**
   * Stops claiming, lets running jobs finish for up to `shutdownGraceMs`, hands whatever is still
   * running back to the queue (they resume where they left off) and resolves when idle.
   */
  stop(): Promise<void> {
    this.stopRequested = true;
    this.stopping ??= this.shutDown();
    return this.stopping;
  }

  /** Nudges the loop to look for work now instead of at the next idle interval. */
  wake(): void {
    this.wakePending = true;
    this.idle?.abort();
  }

  /**
   * Synchronously hands every job this runner is running back to the queue. For `process.on('exit')`
   * handlers, where nothing asynchronous can run any more; the next worker then resumes the jobs
   * at once instead of after their leases run out. Returns how many jobs it released.
   */
  abandon(): number {
    const claimIds = [...this.running.values()].map((job) => job.claimId);
    return releaseWorkerJobs(this.deps.db, claimIds);
  }

  /**
   * One claim-and-process pass: recovers expired leases, claims as many jobs as there are free
   * slots and resolves once those jobs are finished, with how many that was. Works whether or not
   * the loop is running, which is what tests and one-off tools need.
   */
  async tick(): Promise<number> {
    const started = this.claimJobs();
    await Promise.all(started);
    return started.length;
  }

  // ---- Internals ----------------------------------------------------------------------------

  private get now(): () => number {
    return this.deps.now ?? Date.now;
  }

  private get sleep(): (ms: number, signal?: AbortSignal) => Promise<void> {
    return this.deps.sleep ?? realSleep;
  }

  private runtime(claimId: string): JobRuntime {
    const { deps } = this;
    return {
      db: deps.db,
      storage: deps.storage,
      providers: deps.providers,
      env: deps.env,
      log: deps.log,
      workerId: claimId,
      tuning: this.tuning,
      now: this.now,
      sleep: this.sleep,
      random: deps.random ?? Math.random,
      fetch: deps.fetch ?? globalThis.fetch.bind(globalThis),
      fetchOutput: deps.fetchOutput ?? safeFetch,
      persistOutput: deps.persistOutput ?? persistOutput,
      shutdown: this.shutdown.signal,
    };
  }

  /** Claims jobs into free slots and starts them; each returned promise settles when its job ends. */
  private claimJobs(): Promise<void>[] {
    const { deps } = this;
    const started: Promise<void>[] = [];
    if (this.stopRequested) return started;
    const maxAttempts = deps.env.MAX_ATTEMPTS;
    // A job this runner is still running is alive by definition, whatever its lease says: after a
    // stall longer than the lease (or a clock step) the heartbeat has simply not run yet. Leave it
    // alone, or it would be submitted a second time.
    const excludeIds = [...this.running.keys()];
    const recovered = requeueStale(deps.db, this.now(), { maxAttempts, excludeIds });
    if (recovered > 0) deps.log.warn('Recovered generations with expired leases', { recovered });

    while (this.running.size < deps.env.WORKER_CONCURRENCY) {
      const claimId = `${this.workerId}/${this.claims + 1}`;
      const job = claimNextJob(deps.db, claimId, this.tuning.leaseMs, this.now(), {
        maxAttempts,
        excludeIds,
      });
      if (!job) break;
      this.claims += 1; // a claim id is only spent when it was written to a row
      excludeIds.push(job.id);
      const finished: Promise<void> = processJob(job, this.runtime(claimId))
        .catch((error: unknown) => {
          // `processJob` never rejects; this only guards a slot against a bug.
          deps.log.error('Job runner crashed on a job', { err: error, generationId: job.id });
        })
        .finally(() => {
          if (this.running.get(job.id)?.finished === finished) this.running.delete(job.id);
          this.wake();
        });
      this.running.set(job.id, { claimId, finished });
      started.push(finished);
    }
    return started;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        this.claimJobs();
      } catch (error) {
        this.deps.log.error('Could not claim jobs', { err: error });
      }
      await this.waitForWork();
    }
  }

  /** Sleeps until `wake()` or the idle interval, whichever comes first. */
  private async waitForWork(): Promise<void> {
    if (this.wakePending || this.stopRequested) {
      this.wakePending = false;
      return;
    }
    const idle = new AbortController();
    this.idle = idle;
    try {
      await this.sleep(this.tuning.idleMs, idle.signal);
    } catch {
      // Woken early, which is the point.
    } finally {
      this.idle = undefined;
      this.wakePending = false;
    }
  }

  private finishedJobs(): Promise<void>[] {
    return [...this.running.values()].map((job) => job.finished);
  }

  private async shutDown(): Promise<void> {
    this.unregisterWake?.();
    this.unregisterWake = undefined;
    this.wake();
    await this.loop;

    if (this.running.size > 0) {
      const grace = new AbortController();
      const drained = Promise.allSettled(this.finishedJobs()).then(() => true);
      const expired = this.sleep(this.tuning.shutdownGraceMs, grace.signal).then(
        () => false,
        () => true,
      );
      const finishedInTime = await Promise.race([drained, expired]);
      grace.abort();
      if (!finishedInTime) {
        this.deps.log.warn('Shutdown grace period over; handing running jobs back', {
          running: this.running.size,
        });
        this.shutdown.abort();
        await Promise.allSettled(this.finishedJobs());
      }
    }
    this.deps.log.info('Job runner stopped', { workerId: this.workerId });

    // Ready for a later start().
    this.loop = undefined;
    this.stopping = undefined;
    this.stopRequested = false;
    this.shutdown = new AbortController();
  }
}
