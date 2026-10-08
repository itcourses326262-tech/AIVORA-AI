// OWNER: providers-mock
import 'server-only';
import { ProviderError, isProviderError } from '../errors';
import type { GenerationProvider, ProviderInput } from '../types';
import {
  createJobMeta,
  injectedError,
  isFinished,
  latencyFor,
  outcomeFor,
  parseJobMeta,
  parseTriggers,
  progressAt,
} from './job';
import { generateOutputs, requiresInputImage, resolveSeed } from './outputs';
import { hash32 } from './random';

/**
 * The Demo provider: no API key, no network. It makes AIVORE usable out of the box and exercises
 * the real asynchronous job path (submit, poll, resume after a restart).
 *
 * What it produces
 * - text-to-image: procedural artwork (colour field, one of four compositions, vignette, grain) as
 *   lossy WebP at about one megapixel in the requested ratio (1:1 is 1024x1024, 16:9 is
 *   1280x720). The prompt only picks colours and composition; it is never drawn as text.
 * - image-to-image: a seeded colour grade of the input scaled by `strength`; keeps the input's
 *   aspect ratio, ignores `aspectRatio`.
 * - text-to-video and image-to-video: a looping animated GIF (`image/gif`, kind `video`), at most
 *   30 frames and 480 px on the longest side. text-to-video is a flowing scene; image-to-video is
 *   a Ken Burns push-in with a gentle parallax and keeps the input's aspect ratio. `resolution`
 *   only changes the price: the demo clip is always this small preview.
 * - Everything is a pure function of (prompt, negative prompt, seed, size), so the same request
 *   gives the same bytes. Without `params.seed` the seed derives from the generation id. Each of
 *   `count` images gets its own sub-seed, echoed in `ProviderOutput.seed` (image 0 keeps the
 *   request's seed).
 *
 * Asynchronous simulation
 * - `submit` returns `{ mode: 'async', providerJobId, meta }`; `meta` holds the start time, the
 *   duration and the seed. Images take 2.5-4 s and videos 7-10 s, picked from the seed.
 * - `poll` is stateless: progress comes from `Date.now()` and `meta`, and the outputs are rendered
 *   by the first poll that finds the job finished, so a restarted worker simply keeps polling.
 *
 * Failure injection for tests and E2E (substrings of the prompt, case-insensitive)
 * - `__fail__`    poll reports `failed` with ProviderError(unavailable, retryable: false) after the delay
 * - `__content__` poll reports `failed` with ProviderError(content_policy) after the delay
 * - `__slow__`    the job takes 25 s
 * - `__sync__`    submit returns `{ mode: 'sync', outputs }` at once (with `__fail__` or
 *                 `__content__` it throws that ProviderError from submit instead)
 *
 * `cancel` does nothing (there is nothing running upstream). Prompts are never logged, at any level.
 */
export const mockProvider: GenerationProvider = {
  id: 'mock',
  isConfigured: (env) => env.ENABLE_MOCK_PROVIDER,

  async submit(input, ctx) {
    assertUsable(input);
    const triggers = parseTriggers(input.prompt);
    const outcome = outcomeFor(triggers);
    const seed = resolveSeed(input);

    if (triggers.sync) {
      if (outcome !== 'ok') throw injectedError(outcome);
      const outputs = await render(input, seed, ctx.signal);
      ctx.log.debug('mock submit', { generationId: input.generationId, mode: 'sync' });
      return { mode: 'sync', outputs };
    }

    const startedAt = Date.now();
    const durationMs = latencyFor(input.model.kind, seed, triggers);
    const providerJobId = `mock_${startedAt.toString(36)}_${hash32(input.generationId, startedAt, seed).toString(36)}`;
    ctx.log.debug('mock submit', {
      generationId: input.generationId,
      mode: 'async',
      tool: input.tool,
      durationMs,
    });
    return {
      mode: 'async',
      providerJobId,
      meta: createJobMeta(startedAt, durationMs, seed, outcome),
    };
  },

  async poll(_providerJobId, input, ctx, meta) {
    const job = parseJobMeta(meta);
    if (!job) {
      return {
        status: 'failed',
        error: new ProviderError('unknown', 'Demo provider job metadata is missing or malformed', {
          retryable: false,
        }),
      };
    }
    const now = Date.now();
    if (!isFinished(job, now)) return { status: 'running', progress: progressAt(job, now) };
    if (job.outcome !== 'ok') return { status: 'failed', error: injectedError(job.outcome) };

    const outputs = await render(input, job.seed, ctx.signal);
    ctx.log.debug('mock poll finished', {
      generationId: input.generationId,
      outputs: outputs.length,
    });
    return { status: 'succeeded', outputs };
  },

  async cancel() {
    // Nothing runs upstream: the next poll of a canceled job is simply never made.
  },
};

function assertUsable(input: ProviderInput): void {
  if (requiresInputImage(input.tool) && !input.inputImage) {
    throw new ProviderError('invalid_input', `The ${input.tool} tool needs an input image`, {
      userMessage: 'This tool needs an input image.',
    });
  }
}

/** Renders the outputs, reporting any rendering failure as a ProviderError (aborts pass through). */
async function render(input: ProviderInput, seed: number, signal: AbortSignal) {
  try {
    return await generateOutputs(input, seed, signal);
  } catch (error) {
    if (isProviderError(error) || signal.aborted) throw error;
    throw new ProviderError('unknown', 'Demo provider failed to render', { cause: error });
  }
}
