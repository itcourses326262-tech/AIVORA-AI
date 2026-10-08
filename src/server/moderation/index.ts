// OWNER: catalog — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';

export interface ModerationResult {
  allowed: boolean;
  /** Machine-readable category of the match, when blocked. */
  category?: string;
  /** English explanation for logs and API consumers. */
  reason?: string;
}

export interface ModerateOptions {
  /** Stops the optional remote check early. */
  signal?: AbortSignal;
  /** Injected so tests can stub the network. */
  fetch?: typeof fetch;
}

/**
 * Checks a prompt against the built-in conservative English and Arabic blocklist plus
 * `MODERATION_BLOCKLIST`, then (when `MODERATION_PROVIDER=openai`) the remote moderation endpoint.
 * The remote check fails open; the local list never does.
 */
export async function moderatePrompt(
  _text: string,
  _options?: ModerateOptions,
): Promise<ModerationResult> {
  throw new NotImplementedError('moderation.moderatePrompt');
}
