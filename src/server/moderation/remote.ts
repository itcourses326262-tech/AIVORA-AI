import 'server-only';
import { z } from 'zod';
import { MODERATION_CATEGORIES, type ModerationCategory } from './terms';

export const OPENAI_MODERATION_URL = 'https://api.openai.com/v1/moderations';
// UNVERIFIED: the OpenAI docs were not reachable from the build sandbox; the model name comes from
// secondary sources that agree on "omni-moderation-latest" being the current multimodal model.
export const OPENAI_MODERATION_MODEL = 'omni-moderation-latest';
export const DEFAULT_REMOTE_TIMEOUT_MS = 5000;
const MAX_RESPONSE_CHARS = 200_000;

// Only categories that map onto this service's policy block; "violence" or "harassment" flags
// would reject ordinary creative prompts (a battle scene, a villain's speech).
const CATEGORY_MAP: Readonly<Record<string, ModerationCategory>> = {
  'sexual/minors': 'sexual_minors',
  sexual: 'sexual_explicit',
  'violence/graphic': 'graphic_violence',
  hate: 'hate',
  'hate/threatening': 'hate',
};

const responseSchema = z.object({
  results: z.array(z.object({ categories: z.record(z.string(), z.boolean()) })).min(1),
});

export type RemoteModeration =
  | { status: 'ok'; category: ModerationCategory | null }
  /** The check could not be completed; `reason` is safe to log (no prompt, no key, no body). */
  | { status: 'error'; reason: 'timeout' | 'network' | 'http' | 'invalid_response' };

export interface RemoteModerationOptions {
  apiKey: string;
  fetch?: typeof fetch;
  /** The caller's signal: when it aborts, the abort is rethrown instead of reported. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Asks the OpenAI moderation endpoint whether `text` falls into a category this service blocks. */
export async function moderateWithOpenAi(
  text: string,
  options: RemoteModerationOptions,
): Promise<RemoteModeration> {
  const fetchImpl = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetchImpl(OPENAI_MODERATION_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: OPENAI_MODERATION_MODEL, input: text }),
      redirect: 'error',
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { status: 'error', reason: timeout.aborted ? 'timeout' : 'network' };
  }

  if (!response.ok) return { status: 'error', reason: 'http' };
  let body: unknown;
  try {
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_CHARS) return { status: 'error', reason: 'invalid_response' };
    body = JSON.parse(raw);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { status: 'error', reason: timeout.aborted ? 'timeout' : 'invalid_response' };
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return { status: 'error', reason: 'invalid_response' };

  const flagged = new Set<ModerationCategory>();
  for (const result of parsed.data.results) {
    for (const [name, on] of Object.entries(result.categories)) {
      const category = Object.hasOwn(CATEGORY_MAP, name) ? CATEGORY_MAP[name] : undefined;
      if (on && category) flagged.add(category);
    }
  }
  const worst = MODERATION_CATEGORIES.find((category) => flagged.has(category));
  return { status: 'ok', category: worst ?? null };
}
