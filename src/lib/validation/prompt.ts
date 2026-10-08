import { z } from 'zod';
import { KINDS } from '@/lib/catalog/types';
import { LOCALES } from '@/lib/i18n/locales';

export const MAX_ENHANCE_PROMPT_CHARS = 2000;

/** Body of `POST /prompt/enhance`; kept equal to `EnhancePromptRequest` by a compile-time test. */
export const enhancePromptRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(MAX_ENHANCE_PROMPT_CHARS),
    kind: z.enum(KINDS),
    locale: z.enum(LOCALES).optional(),
  })
  .strict();
