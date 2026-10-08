// OWNER: provider-fal
import 'server-only';
import type { Env } from '@/server/env';
import { ProviderError } from '../errors';
import type { GenerationProvider, PollResult, ProviderInput, SubmitResult } from '../types';
import { getFalAdapter } from './adapters';
import {
  cancelJob,
  fetchResult,
  fetchStatus,
  isFalQueueUrl,
  resolveUrls,
  submitJob,
} from './client';
import { jobFailure } from './errors';
import { outputsFromResult } from './outputs';
import { metaSchema, type FalMeta } from './schemas';

/*
 * fal.ai through its queue API (https://queue.fal.run). `submit` always answers `async`: the
 * request id is the provider job id and the status, result and cancel URLs fal returned are kept in
 * the generation's `providerMeta` (never the key, never the prompt).
 *
 * `poll` makes one status call, plus a result call once the status is COMPLETED. It returns
 * `failed` when fal reports that the request failed (a failed status, an error on a completed one,
 * or an error payload when fetching the result) and throws only when the state could not be read
 * (network, 429, a 5xx or 408 that fal did not type, bad credentials), so the caller may poll
 * again. `submit` is the opposite for an outcome it cannot know: a lost response or timeout is
 * final, because a retry would queue a second paid request (see `submitJob`).
 */

function readMeta(value: Record<string, unknown> | undefined): FalMeta | undefined {
  const parsed = metaSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function urlsFor(jobId: string, input: ProviderInput, meta: Record<string, unknown> | undefined) {
  const stored = readMeta(meta);
  return resolveUrls(input.model.providerModel, jobId, {
    statusUrl: stored?.statusUrl,
    responseUrl: stored?.responseUrl,
    cancelUrl: stored?.cancelUrl,
  });
}

const FAILED_STATUSES = new Set(['FAILED', 'ERROR', 'CANCELLED', 'CANCELED']);

export const falProvider: GenerationProvider = {
  id: 'fal',

  isConfigured(env: Env): boolean {
    return Boolean(env.FAL_KEY);
  },

  async submit(input, ctx): Promise<SubmitResult> {
    const adapter = getFalAdapter(input.model.providerModel);
    const body = await adapter.buildInput(input);
    const { requestId, urls } = await submitJob(ctx, input.model.providerModel, body);
    ctx.log.info('fal request queued', {
      model: input.model.providerModel,
      generationId: input.generationId,
      requestId,
    });
    const meta: FalMeta = { v: 1, requestId, ...urls };
    return { mode: 'async', providerJobId: requestId, meta };
  },

  async poll(providerJobId, input, ctx, meta): Promise<PollResult> {
    const urls = urlsFor(providerJobId, input, meta);
    const status = await fetchStatus(ctx, urls.statusUrl);
    const name = status.status.toUpperCase();

    if (name === 'IN_QUEUE') return { status: 'pending' };
    if (name === 'IN_PROGRESS') return { status: 'running' };
    if (
      FAILED_STATUSES.has(name) ||
      (name === 'COMPLETED' && (status.error || status.error_type))
    ) {
      return { status: 'failed', error: jobFailure(status) };
    }
    if (name !== 'COMPLETED') {
      ctx.log.warn('fal returned an unknown queue status', { status: status.status });
      return { status: 'pending' };
    }

    const fetched = await fetchResult(ctx, urls.responseUrl);
    if (!fetched.ok) return { status: 'failed', error: fetched.error };
    try {
      return { status: 'succeeded', outputs: outputsFromResult(fetched.result, input) };
    } catch (error) {
      if (error instanceof ProviderError) return { status: 'failed', error };
      throw error;
    }
  },

  async cancel(providerJobId, ctx, meta): Promise<void> {
    const stored = readMeta(meta);
    if (!stored || !isFalQueueUrl(stored.cancelUrl)) {
      // Without a stored fal URL the endpoint is unknown, and a guessed URL could hit another job.
      ctx.log.debug('fal cancel skipped: no stored queue URL', { requestId: providerJobId });
      return;
    }
    await cancelJob(ctx, stored.cancelUrl);
  },
};
