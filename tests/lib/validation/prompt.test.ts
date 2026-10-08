import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { EnhancePromptRequest } from '@/lib/api-types';
import {
  MAX_ENHANCE_PROMPT_CHARS,
  enhancePromptRequestSchema as schema,
} from '@/lib/validation/prompt';

describe('enhancePromptRequestSchema', () => {
  it('is the EnhancePromptRequest of the wire contract', () => {
    expectTypeOf<z.infer<typeof schema>>().toEqualTypeOf<EnhancePromptRequest>();
  });

  it('accepts a prompt, a kind and an optional locale', () => {
    expect(schema.parse({ prompt: 'a cat', kind: 'image' })).toEqual({
      prompt: 'a cat',
      kind: 'image',
    });
    expect(schema.parse({ prompt: 'قطة', kind: 'video', locale: 'ar' })).toEqual({
      prompt: 'قطة',
      kind: 'video',
      locale: 'ar',
    });
  });

  it('trims the prompt and enforces 1 to 2000 characters', () => {
    expect(schema.parse({ prompt: '  a cat  ', kind: 'image' }).prompt).toBe('a cat');
    expect(MAX_ENHANCE_PROMPT_CHARS).toBe(2000);
    expect(schema.safeParse({ prompt: 'x'.repeat(2000), kind: 'image' }).success).toBe(true);
    expect(schema.safeParse({ prompt: 'x'.repeat(2001), kind: 'image' }).success).toBe(false);
    expect(schema.safeParse({ prompt: '   ', kind: 'image' }).success).toBe(false);
  });

  it.each([
    { prompt: 'a cat' },
    { prompt: 'a cat', kind: 'audio' },
    { prompt: 'a cat', kind: 'image', locale: 'fr' },
    { prompt: 'a cat', kind: 'image', extra: true },
    { prompt: 42, kind: 'image' },
    null,
    'a cat',
  ])('rejects %j', (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});
