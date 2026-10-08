import 'server-only';
import type { EnhancePromptRequest, EnhancePromptResponse } from '@/lib/api-types';
import { getEnv, type Env } from '@/server/env';
import { getLogger } from '@/server/logger';
import { enhanceHeuristically, MAX_ENHANCED_CHARS } from './heuristic';
import {
  buildSystemPrompt,
  buildUserMessage,
  completeWithAnthropic,
  completeWithOpenAi,
} from './llm';
import { EnhancerFailure, sanitizeEnhancedPrompt } from './sanitize';
import { arabicLetterRatio, hasArabicScript } from './text';

export interface EnhancePromptDeps {
  /** Defaults to `getEnv()`. */
  env?: Env;
  /** Injected so tests can stub the LLM call. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Time allowed per LLM call before falling back. Default 8000. */
  timeoutMs?: number;
}

type LlmEngine = 'openai' | 'anthropic';

/** Engines to try, in order, for `PROMPT_ENHANCER` and the keys that exist. */
function enginesFor(env: Env): LlmEngine[] {
  const available: LlmEngine[] = [];
  if (env.OPENAI_API_KEY) available.push('openai');
  if (env.ANTHROPIC_API_KEY) available.push('anthropic');
  switch (env.PROMPT_ENHANCER) {
    case 'heuristic':
      return [];
    case 'openai':
      return available.filter((engine) => engine === 'openai');
    case 'anthropic':
      return available.filter((engine) => engine === 'anthropic');
    case 'auto':
      return available;
  }
}

// An answer that still reads as Arabic was not translated, whatever the model claims.
const TRANSLATED_MAX_ARABIC_SHARE = 0.3;

/**
 * Improves a prompt with an LLM when `PROMPT_ENHANCER` and the keys allow it (translating Arabic
 * to English for English-centric models and adding subject, style, lighting and composition),
 * otherwise, or when the LLM call fails, with the heuristic enhancer. The result contains only
 * the prompt text.
 */
export async function enhancePrompt(
  input: EnhancePromptRequest,
  deps: EnhancePromptDeps = {},
): Promise<EnhancePromptResponse> {
  const env = deps.env ?? getEnv();
  const log = getLogger();
  const request = { ...input, prompt: input.prompt.trim() };
  if (request.prompt === '') return enhanceHeuristically(request);

  const engines = enginesFor(env);
  if (
    engines.length === 0 &&
    env.PROMPT_ENHANCER !== 'heuristic' &&
    env.PROMPT_ENHANCER !== 'auto'
  ) {
    log.warn('The configured prompt enhancer has no API key; using the heuristic enhancer', {
      engine: env.PROMPT_ENHANCER,
    });
  }

  const system = buildSystemPrompt(request.kind);
  const user = buildUserMessage(request.prompt);
  const call = {
    system,
    user,
    fetch: deps.fetch ?? fetch,
    signal: deps.signal,
    timeoutMs: deps.timeoutMs,
  };

  for (const engine of engines) {
    try {
      const raw =
        engine === 'openai'
          ? await completeWithOpenAi({
              ...call,
              apiKey: env.OPENAI_API_KEY as string,
              model: env.PROMPT_ENHANCER_OPENAI_MODEL,
            })
          : await completeWithAnthropic({
              ...call,
              apiKey: env.ANTHROPIC_API_KEY as string,
              model: env.PROMPT_ENHANCER_ANTHROPIC_MODEL,
            });
      const prompt = sanitizeEnhancedPrompt(raw, MAX_ENHANCED_CHARS);
      const translated =
        hasArabicScript(request.prompt) && arabicLetterRatio(prompt) < TRANSLATED_MAX_ARABIC_SHARE;
      return { prompt, engine, translated };
    } catch (error) {
      // A cancelled request is not an engine failure: nobody is waiting for a fallback.
      if (deps.signal?.aborted) throw error;
      const reason = error instanceof EnhancerFailure ? error.reason : 'unexpected';
      log.warn('Prompt enhancer engine failed; falling back', { engine, reason });
    }
  }
  return enhanceHeuristically(request);
}
