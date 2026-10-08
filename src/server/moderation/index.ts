import 'server-only';
import { AppError } from '@/lib/errors';
import { getEnv, type Env } from '@/server/env';
import { getLogger } from '@/server/logger';
import { getLocalMatcher } from './matcher';
import { negativePromptCategory } from './negative';
import { moderateWithOpenAi } from './remote';
import { CATEGORY_REASONS, type ModerationCategory } from './terms';

export type { ModerationCategory } from './terms';
export { negativePromptCategory, type NegativePromptContext } from './negative';

/**
 * The most text `moderatePrompt` accepts. Prompts are validated far below this (4000 characters
 * at the schema, less per model), so it only bounds a caller that skipped validation.
 */
export const MAX_MODERATED_CHARS = 20_000;

export interface ModerationResult {
  allowed: boolean;
  /** Machine-readable category of the match, when blocked. */
  category?: ModerationCategory;
  /** Generic English explanation for logs and API consumers; never repeats the matched term. */
  reason?: string;
}

export interface ModerateOptions {
  /** Stops the optional remote check early. */
  signal?: AbortSignal;
  /** Injected so tests can stub the network. */
  fetch?: typeof fetch;
  /** Defaults to `getEnv()`. */
  env?: Env;
  /** Time allowed for the remote check; it fails open when exceeded. Default 5000. */
  remoteTimeoutMs?: number;
  /**
   * The request's negative prompt. It is not moderated like a prompt (people must be able to write
   * "nsfw, nude"), only checked for excluding clothing to steer the prompt toward nudity.
   */
  negativePrompt?: string;
  /**
   * The request edits an uploaded photo (image-to-image, image-to-video). A real person may be in
   * it, so nudity and undress words are blocked as non-consensual content.
   */
  hasInputImage?: boolean;
}

type BlockSource = 'local' | 'remote' | 'negative_prompt';

function blocked(category: ModerationCategory, source: BlockSource): ModerationResult {
  getLogger().info('Prompt blocked by moderation', { category, source });
  return { allowed: false, category, reason: CATEGORY_REASONS[category] };
}

function assertWithinLimit(text: string): void {
  if (text.length > MAX_MODERATED_CHARS) {
    throw AppError.of('validation_failed', 'Text is too long to moderate', {
      maxChars: MAX_MODERATED_CHARS,
    });
  }
}

/**
 * Checks a prompt against the built-in conservative English and Arabic rules plus
 * `MODERATION_BLOCKLIST`, then (when `MODERATION_PROVIDER=openai`) the remote moderation endpoint.
 * The remote check fails open (an outage must not stop every generation) and logs a warning;
 * the local rules never fail open. Callers validate the prompt length first; text longer than
 * {@link MAX_MODERATED_CHARS} is rejected with a `validation_failed` error instead of scanned.
 */
export async function moderatePrompt(
  text: string,
  options: ModerateOptions = {},
): Promise<ModerationResult> {
  assertWithinLimit(text);
  if (options.negativePrompt !== undefined) assertWithinLimit(options.negativePrompt);
  if (text.trim() === '') return { allowed: true };
  const env = options.env ?? getEnv();

  const local = getLocalMatcher(env.MODERATION_BLOCKLIST).check(text, {
    hasInputImage: options.hasInputImage,
  });
  if (local) return blocked(local, 'local');

  if (options.negativePrompt !== undefined) {
    const inverted = negativePromptCategory(options.negativePrompt, {
      prompt: text,
      hasInputImage: options.hasInputImage,
    });
    if (inverted) return blocked(inverted, 'negative_prompt');
  }

  if (env.MODERATION_PROVIDER !== 'openai') return { allowed: true };
  if (!env.OPENAI_API_KEY) {
    getLogger().warn('Remote moderation is enabled but OPENAI_API_KEY is missing; skipping it');
    return { allowed: true };
  }
  const remote = await moderateWithOpenAi(text, {
    apiKey: env.OPENAI_API_KEY,
    fetch: options.fetch,
    signal: options.signal,
    timeoutMs: options.remoteTimeoutMs,
  });
  if (remote.status === 'error') {
    getLogger().warn('Remote moderation failed; allowing the prompt', { reason: remote.reason });
    return { allowed: true };
  }
  return remote.category ? blocked(remote.category, 'remote') : { allowed: true };
}
