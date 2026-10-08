import 'server-only';
import { getEnv, type Env } from '@/server/env';
import { getLogger } from '@/server/logger';
import { getLocalMatcher } from './matcher';
import { moderateWithOpenAi } from './remote';
import { CATEGORY_REASONS, type ModerationCategory } from './terms';

export type { ModerationCategory } from './terms';

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
}

function blocked(category: ModerationCategory, source: 'local' | 'remote'): ModerationResult {
  getLogger().info('Prompt blocked by moderation', { category, source });
  return { allowed: false, category, reason: CATEGORY_REASONS[category] };
}

/**
 * Checks a prompt against the built-in conservative English and Arabic rules plus
 * `MODERATION_BLOCKLIST`, then (when `MODERATION_PROVIDER=openai`) the remote moderation endpoint.
 * The remote check fails open (an outage must not stop every generation) and logs a warning;
 * the local rules never fail open. Callers validate the prompt length first.
 */
export async function moderatePrompt(
  text: string,
  options: ModerateOptions = {},
): Promise<ModerationResult> {
  if (text.trim() === '') return { allowed: true };
  const env = options.env ?? getEnv();

  const local = getLocalMatcher(env.MODERATION_BLOCKLIST).check(text);
  if (local) return blocked(local, 'local');

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
