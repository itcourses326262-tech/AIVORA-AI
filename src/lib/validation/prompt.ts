import { z } from 'zod';
import { KINDS } from '@/lib/catalog/types';
import { LOCALES } from '@/lib/i18n/locales';
import { hasVisibleText } from './visible-text';

export const MAX_ENHANCE_PROMPT_CHARS = 2000;

/** Body of `POST /prompt/enhance`; kept equal to `EnhancePromptRequest` by a compile-time test. */
export const enhancePromptRequestSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(MAX_ENHANCE_PROMPT_CHARS)
      // Zero-width characters survive `trim`, so a "blank" draft would otherwise reach the engines.
      .refine(hasVisibleText, { message: 'Prompt must not be empty' }),
    kind: z.enum(KINDS),
    locale: z.enum(LOCALES).optional(),
  })
  .strict();
