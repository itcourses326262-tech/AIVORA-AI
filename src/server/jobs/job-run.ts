import 'server-only';
import { getModel } from '@/lib/catalog';
import { clamp } from '@/lib/utils';
import type { GenerationRow } from '@/server/db/schema';
import {
  completeGeneration,
  extendLease,
  failGeneration,
  recordSubmitted,
  releaseJob,
  updateProgress,
} from '@/server/generations/lifecycle';
import { findGenerationRow } from '@/server/generations/queries';
import type { Logger } from '@/server/logger';
import { isProviderError } from '@/server/providers/errors';
import type {
  GenerationProvider,
  PollResult,
  ProviderContext,
  ProviderInput,
  ProviderOutput,
  SubmitResult,
} from '@/server/providers/types';
import { createPollBackoff, retryDelayMs } from './backoff';
import { JobFailure, TIMEOUT_FAILURE, describeFailure } from './failure';
import { buildProviderInput } from './input';
import { discardOutputs, materializeOutputs } from './outputs';
import type { JobRuntime } from './runtime';

/** Why a run stopped without a result of its own. */
type Interruption = 'timeout' | 'canceled' | 'lost' | 'shutdown';

class Interrupted extends Error {
  override readonly name = 'Interrupted';

  constructor(readonly reason: Interruption) {
    super(`Job interrupted: ${reason}`);
  }
}

// Progress is 0-100 and only moves forward. The ranges are a story for the progress bar, not a
// measurement: preparing, submitted, then the provider's own number squeezed into 10-85.
const PREPARED_PROGRESS = 3;
const SUBMITTED_PROGRESS = 10;
const POLL_PROGRESS_SPAN = 75;
const POLL_PROGRESS_MAX = 85;
const IDLE_PROGRESS_STEP = 4;
const FINISHING_PROGRESS = 90;
const CANCEL_UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * One claimed generation, from provider submit to completed asset rows (section 6.6, section 8).
 *
 * The run is resumable: a job that already has a `providerJobId` goes straight to polling with the
 * stored `providerMeta`. While it runs, a background heartbeat extends the lease, and a timer
 * enforces the per-kind deadline. Either one, a cancel seen between polls, or a shutdown ends the
 * run through {@link Interrupted}, which aborts the signal handed to the provider.
 *
 * Every outcome is a compare-and-set in `lifecycle.ts`, so a run that lost its job (canceled,
 * deleted, taken over after a stall) can never overwrite whoever owns it now. `run()` never throws.
 */
export class JobRun {
  private readonly guard = new AbortController();
  private readonly background = new AbortController();
  private readonly log: Logger;
  private reason: Interruption | undefined;
  private deadline = 0;
  private lastProgress: number;
  private providerJobId: string | null;
  private meta: Record<string, unknown> | undefined;
  private provider: GenerationProvider | undefined;
  private input: ProviderInput | undefined;

  constructor(
    private readonly job: GenerationRow,
    private readonly rt: JobRuntime,
  ) {
    this.log = rt.log.child({ generationId: job.id, tool: job.tool, modelId: job.modelId });
    this.lastProgress = job.progress;
    this.providerJobId = job.providerJobId;
    this.meta = job.providerMeta ?? undefined;
  }

  async run(): Promise<void> {
    const { rt, job } = this;
    const timeoutSec =
      job.kind === 'video'
        ? rt.env.GENERATION_TIMEOUT_SEC_VIDEO
        : rt.env.GENERATION_TIMEOUT_SEC_IMAGE;
    const startedAt = rt.now();
    this.deadline = startedAt + timeoutSec * 1000;

    const onShutdown = () => this.interrupt('shutdown');
    if (rt.shutdown.aborted) onShutdown();
    else rt.shutdown.addEventListener('abort', onShutdown, { once: true });
    const background = [this.heartbeat(), this.enforceDeadline()];

    try {
      await this.execute();
    } catch (error) {
      await this.handleError(error);
    } finally {
      this.background.abort();
      rt.shutdown.removeEventListener('abort', onShutdown);
      await Promise.allSettled(background);
    }
    this.log.debug('Job run ended', { durationMs: rt.now() - startedAt, interrupted: this.reason });
  }

  // ---- The happy path ---------------------------------------------------------------------

  private async execute(): Promise<void> {
    const { rt, job } = this;
    const model = getModel(job.modelId);
    if (!model) throw new JobFailure('unavailable', 'This model is no longer available.');
    const provider = rt.providers.getProvider(job.provider);
    if (!provider.isConfigured(rt.env)) {
      throw new JobFailure('unavailable', 'The generation service is not available right now.');
    }
    this.provider = provider;
    this.input = await buildProviderInput(job, model, rt);
    this.checkAlive();
    this.report(PREPARED_PROGRESS);

    let outputs: ProviderOutput[] | undefined;
    if (this.providerJobId === null) {
      const submitted = await this.submit(provider, this.input);
      if (submitted.mode === 'sync') {
        outputs = submitted.outputs;
      } else {
        this.recordAsync(submitted);
      }
    } else {
      this.log.info('Resuming a submitted job', { attempt: job.attempts });
    }
    outputs ??= await this.poll(provider, this.input);
    await this.finish(outputs);
  }

  private async submit(provider: GenerationProvider, input: ProviderInput): Promise<SubmitResult> {
    const { rt } = this;
    for (let attempt = 1; ; attempt += 1) {
      this.checkAlive();
      try {
        const result = await provider.submit(input, this.context());
        this.throwIfInterrupted();
        return result;
      } catch (error) {
        this.throwIfInterrupted();
        if (!isProviderError(error) || !error.retryable || attempt >= rt.env.MAX_ATTEMPTS) {
          throw error;
        }
        this.log.warn('Provider submit failed; retrying', { attempt, code: error.code });
        await rt.sleep(retryDelayMs(attempt, rt.random, error.retryAfterMs), this.guard.signal);
      }
    }
  }

  private recordAsync(submitted: Extract<SubmitResult, { mode: 'async' }>): void {
    const { rt, job } = this;
    if (submitted.providerJobId === '') {
      throw new JobFailure('unavailable', 'The generation service returned an invalid response.');
    }
    this.providerJobId = submitted.providerJobId;
    this.meta = submitted.meta;
    if (!recordSubmitted(rt.db, job.id, rt.workerId, submitted.providerJobId, submitted.meta)) {
      this.ownershipLost();
      this.throwIfInterrupted();
    }
    this.report(SUBMITTED_PROGRESS);
  }

  private async poll(
    provider: GenerationProvider,
    input: ProviderInput,
  ): Promise<ProviderOutput[]> {
    const { rt } = this;
    const providerJobId = this.providerJobId;
    if (providerJobId === null) throw new Error('poll() needs a provider job id');
    const backoff = createPollBackoff(this.job.kind, rt.random);
    let failures = 0;
    for (;;) {
      this.checkAlive();
      let result: PollResult;
      try {
        result = await provider.poll(providerJobId, input, this.context(), this.meta);
        this.throwIfInterrupted();
      } catch (error) {
        this.throwIfInterrupted();
        failures += 1;
        if (!isProviderError(error) || !error.retryable || failures > rt.tuning.maxPollErrors) {
          throw error;
        }
        this.log.warn('Provider poll failed; retrying', { failures, code: error.code });
        await rt.sleep(retryDelayMs(failures, rt.random, error.retryAfterMs), this.guard.signal);
        continue;
      }
      failures = 0;
      if (result.status === 'succeeded') return result.outputs;
      if (result.status === 'failed') throw result.error;
      this.reportPoll(result.progress);
      await rt.sleep(backoff.next(), this.guard.signal);
    }
  }

  private async finish(outputs: readonly ProviderOutput[]): Promise<void> {
    const { rt, job } = this;
    this.checkAlive();
    this.report(FINISHING_PROGRESS);
    const persisted = await materializeOutputs(outputs, {
      job,
      rt,
      signal: this.guard.signal,
      remainingMs: () => this.deadline - rt.now(),
    });
    if (persisted.length === 0) {
      throw new JobFailure('unavailable', 'The generation service returned no usable result.');
    }

    let completed: boolean;
    try {
      completed = completeGeneration(rt.db, job.id, rt.workerId, persisted);
    } catch (error) {
      await discardOutputs(rt, persisted);
      throw error;
    }
    if (!completed) {
      // Canceled, deleted or taken over while the files were being written: nobody wants them.
      await discardOutputs(rt, persisted);
      this.log.info('Dropped a finished result because the job is no longer ours');
      return;
    }
    this.log.info('Generation succeeded', {
      outputs: persisted.length,
      requested: job.params.count,
    });
  }

  // ---- Failure and interruption -------------------------------------------------------------

  private async handleError(error: unknown): Promise<void> {
    const interruption = this.reason ?? (error instanceof Interrupted ? error.reason : undefined);
    try {
      if (interruption) {
        await this.afterInterruption(interruption);
        return;
      }
      const { failure, severity } = describeFailure(error);
      this.log[severity](
        severity === 'error' && !isProviderError(error)
          ? 'Generation failed unexpectedly'
          : 'Generation failed',
        severity === 'info' ? { code: failure.code } : { err: error, code: failure.code },
      );
      failGeneration(this.rt.db, this.job.id, this.rt.workerId, failure);
    } catch (secondary) {
      // The lease will expire and `requeueStale` decides what happens to the job.
      this.log.error('Could not record the outcome of a generation', { err: secondary });
    }
  }

  private async afterInterruption(reason: Interruption): Promise<void> {
    const { rt, job } = this;
    switch (reason) {
      case 'timeout':
        this.log.warn('Generation timed out');
        await this.cancelUpstream();
        failGeneration(rt.db, job.id, rt.workerId, TIMEOUT_FAILURE);
        return;
      case 'canceled':
        this.log.info('Generation was canceled while running');
        await this.cancelUpstream();
        return;
      case 'shutdown':
        this.log.info('Handing the job back to the queue for shutdown');
        releaseJob(rt.db, job.id, rt.workerId);
        return;
      case 'lost':
        this.log.warn('Lost ownership of the job; leaving it to its new owner');
        return;
    }
  }

  /** Best effort and bounded: a provider that hangs must not hold up the worker. */
  private async cancelUpstream(): Promise<void> {
    const { provider, providerJobId } = this;
    if (!provider?.cancel || providerJobId === null) return;
    try {
      await provider.cancel(
        providerJobId,
        { ...this.context(), signal: AbortSignal.timeout(CANCEL_UPSTREAM_TIMEOUT_MS) },
        this.meta,
      );
    } catch (error) {
      this.log.warn('Could not cancel the upstream job', { err: error });
    }
  }

  // ---- Ownership, heartbeat, deadline --------------------------------------------------------

  private interrupt(reason: Interruption): void {
    if (this.reason) return;
    this.reason = reason;
    this.guard.abort(new Interrupted(reason));
  }

  private throwIfInterrupted(): void {
    if (this.reason) throw new Interrupted(this.reason);
  }

  /** Reads why the row stopped being ours: canceled or deleted by the user, or taken over. */
  private ownershipLost(): void {
    const row = findGenerationRow(this.rt.db, this.job.id);
    this.interrupt(!row || row.status === 'canceled' ? 'canceled' : 'lost');
  }

  /** Throws unless the job is still ours, still `processing` and inside its deadline. */
  private checkAlive(): void {
    const { rt, job } = this;
    this.throwIfInterrupted();
    const row = findGenerationRow(rt.db, job.id);
    if (!row || row.status === 'canceled') this.interrupt('canceled');
    else if (row.status !== 'processing' || row.workerId !== rt.workerId) this.interrupt('lost');
    else if (rt.now() >= this.deadline) this.interrupt('timeout');
    this.throwIfInterrupted();
  }

  private async heartbeat(): Promise<void> {
    const { rt, job } = this;
    try {
      for (;;) {
        await rt.sleep(rt.tuning.heartbeatMs, this.background.signal);
        try {
          if (!extendLease(rt.db, job.id, rt.workerId, rt.tuning.leaseMs, rt.now())) {
            this.ownershipLost();
            return;
          }
        } catch (error) {
          this.log.warn('Could not extend the lease', { err: error });
        }
      }
    } catch {
      // The run ended, which is how the heartbeat is stopped.
    }
  }

  private async enforceDeadline(): Promise<void> {
    const { rt } = this;
    try {
      await rt.sleep(Math.max(0, this.deadline - rt.now()), this.background.signal);
      this.interrupt('timeout');
    } catch {
      // The run ended first.
    }
  }

  // ---- Provider context and progress ---------------------------------------------------------

  private context(): ProviderContext {
    return {
      signal: this.guard.signal,
      env: this.rt.env,
      fetch: this.rt.fetch,
      log: this.log.child({ provider: this.job.provider }),
    };
  }

  private report(value: number): void {
    const next = Math.min(99, Math.max(0, Math.round(value)));
    if (next <= this.lastProgress) return;
    this.lastProgress = next;
    try {
      updateProgress(this.rt.db, this.job.id, this.rt.workerId, next);
    } catch (error) {
      this.log.debug('Could not store progress', { err: error });
    }
  }

  private reportPoll(progress: number | undefined): void {
    const fromProvider =
      typeof progress === 'number' && Number.isFinite(progress)
        ? SUBMITTED_PROGRESS + (clamp(progress, 0, 100) / 100) * POLL_PROGRESS_SPAN
        : this.lastProgress + IDLE_PROGRESS_STEP;
    this.report(Math.min(POLL_PROGRESS_MAX, fromProvider));
  }
}

/** Runs one claimed job to its outcome. Never rejects. */
export function processJob(job: GenerationRow, rt: JobRuntime): Promise<void> {
  return new JobRun(job, rt).run();
}
