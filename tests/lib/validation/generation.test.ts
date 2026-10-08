import { describe, expect, it } from 'vitest';
import { newId } from '@/lib/id';
import {
  MAX_NEGATIVE_PROMPT_CHARS_HARD,
  MAX_PROMPT_CHARS_HARD,
  createGenerationRequestSchema as schema,
} from '@/lib/validation/generation';

const minimal = {
  tool: 'text-to-image',
  modelId: 'aivore-demo-image',
  prompt: 'a red fox',
} as const;

describe('createGenerationRequestSchema', () => {
  it('accepts the minimal request and keeps it as is', () => {
    expect(schema.parse(minimal)).toEqual(minimal);
  });

  it('accepts a complete request', () => {
    const request = {
      tool: 'image-to-video',
      modelId: 'aivore-demo-video',
      prompt: 'the fox runs',
      negativePrompt: 'blurry',
      params: {
        aspectRatio: '16:9',
        count: 1,
        durationSec: 5,
        resolution: '720p',
        seed: 42,
        strength: 0.6,
      },
      inputAssetId: newId('ast'),
      isPublic: true,
    };
    expect(schema.parse(request)).toEqual(request);
  });

  it('trims the prompt and model id', () => {
    const parsed = schema.parse({ ...minimal, modelId: '  m1 ', prompt: '  hello  ' });
    expect(parsed.modelId).toBe('m1');
    expect(parsed.prompt).toBe('hello');
  });

  it('keeps a prompt with a zero-width character inside real text', () => {
    expect(schema.parse({ ...minimal, prompt: 'می\u200cخواهم' }).prompt).toBe('می\u200cخواهم');
  });

  it('accepts partial params', () => {
    expect(schema.parse({ ...minimal, params: { seed: 0 } }).params).toEqual({ seed: 0 });
    expect(schema.parse({ ...minimal, params: {} }).params).toEqual({});
  });

  it.each([
    ['missing tool', { modelId: 'm', prompt: 'p' }],
    ['unknown tool', { ...minimal, tool: 'text-to-audio' }],
    ['empty model id', { ...minimal, modelId: '  ' }],
    ['missing prompt', { tool: 'text-to-image', modelId: 'm' }],
    ['blank prompt', { ...minimal, prompt: '   ' }],
    ['prompt of zero-width characters', { ...minimal, prompt: '\u200b\u200b' }],
    ['prompt of invisible characters and spaces', { ...minimal, prompt: ' \u2060\ufeff \u200d ' }],
    ['prompt too long', { ...minimal, prompt: 'x'.repeat(MAX_PROMPT_CHARS_HARD + 1) }],
    [
      'negative prompt too long',
      { ...minimal, negativePrompt: 'x'.repeat(MAX_NEGATIVE_PROMPT_CHARS_HARD + 1) },
    ],
    ['bad aspect ratio', { ...minimal, params: { aspectRatio: '5:4' } }],
    ['zero count', { ...minimal, params: { count: 0 } }],
    ['fractional count', { ...minimal, params: { count: 1.5 } }],
    ['huge count', { ...minimal, params: { count: 100 } }],
    ['zero duration', { ...minimal, params: { durationSec: 0 } }],
    ['bad resolution', { ...minimal, params: { resolution: '4k' } }],
    ['negative seed', { ...minimal, params: { seed: -1 } }],
    ['seed beyond uint32', { ...minimal, params: { seed: 4_294_967_296 } }],
    ['strength above 1', { ...minimal, params: { strength: 1.1 } }],
    ['strength below 0', { ...minimal, params: { strength: -0.1 } }],
    ['asset id of the wrong kind', { ...minimal, inputAssetId: newId('gen') }],
    ['asset id that is not an id', { ...minimal, inputAssetId: '../../etc/passwd' }],
    ['non-boolean isPublic', { ...minimal, isPublic: 'yes' }],
    ['string count', { ...minimal, params: { count: '2' } }],
  ])('rejects %s', (_label, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it('rejects unknown keys so typos are not silently ignored', () => {
    expect(schema.safeParse({ ...minimal, aspect_ratio: '1:1' }).success).toBe(false);
    expect(schema.safeParse({ ...minimal, params: { aspect_ratio: '1:1' } }).success).toBe(false);
  });

  it('reports the failing path', () => {
    const result = schema.safeParse({ ...minimal, params: { count: 0 } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['params', 'count']);
  });

  it.each([null, undefined, 'text', 42, []])('rejects a non-object body (%j)', (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});
