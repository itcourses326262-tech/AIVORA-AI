// OWNER: catalog — replace this stub
import 'server-only';
import type { EnhancePromptRequest, EnhancePromptResponse } from '@/lib/api-types';
import { NotImplementedError } from '@/lib/errors';
import type { Env } from '@/server/env';

export interface EnhancePromptDeps {
  /** Defaults to `getEnv()`. */
  env?: Env;
  /** Injected so tests can stub the LLM call. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Improves a prompt with an LLM when `PROMPT_ENHANCER` and the keys allow it (translating Arabic
 * to English for English-centric models and adding subject, style, lighting and composition),
 * otherwise with the heuristic enhancer. The result contains only the prompt text.
 */
export async function enhancePrompt(
  _input: EnhancePromptRequest,
  _deps?: EnhancePromptDeps,
): Promise<EnhancePromptResponse> {
  throw new NotImplementedError('prompt.enhancePrompt');
}
