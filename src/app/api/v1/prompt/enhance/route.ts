import type { EnhancePromptResponse } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { enhancePromptRequestSchema } from '@/lib/validation/prompt';
import { route } from '@/server/http/route';
import { moderatePrompt } from '@/server/moderation';
import { enhancePrompt } from '@/server/prompt/enhancer';

/**
 * Improves a draft prompt (LLM when a key exists, heuristic otherwise). Each call may cost an LLM
 * request, so it has its own small budget per user instead of the general one. The draft is
 * moderated first: the enhancer must never be a way to launder a blocked prompt.
 */
export const POST = route(
  {
    auth: 'required',
    rateLimit: { name: 'prompt-enhance', limit: 20, windowSec: 60, by: 'user' },
    maxBodyBytes: 16 * 1024,
  },
  async (ctx): Promise<EnhancePromptResponse> => {
    const body = await ctx.body(enhancePromptRequestSchema);

    const verdict = await moderatePrompt(body.prompt, { signal: ctx.req.signal });
    if (!verdict.allowed) {
      throw AppError.of('moderation_blocked', verdict.reason ?? 'This prompt is not allowed', {
        category: verdict.category,
      });
    }
    return enhancePrompt(body, { signal: ctx.req.signal });
  },
);
