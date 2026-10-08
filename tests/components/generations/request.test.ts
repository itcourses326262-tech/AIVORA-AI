import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationDTO } from '@/lib/api-types';
import { newIdempotencyKey, requestFromGeneration } from '@/lib/generations/request';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newIdempotencyKey', () => {
  it('is a fresh UUID each time', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it('falls back to random bytes where crypto.randomUUID does not exist (plain HTTP)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(171);
        return bytes;
      },
    });
    const key = newIdempotencyKey();
    expect(key).toBe('ab'.repeat(16));
    // The server accepts 1 to 128 visible ASCII characters.
    expect(key).toMatch(/^[\x21-\x7e]{1,128}$/);
  });

  it('still produces a usable key without any crypto', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('requestFromGeneration', () => {
  const base: GenerationDTO = {
    id: 'gen_1',
    tool: 'image-to-video',
    kind: 'video',
    modelId: 'aivore-demo-video',
    prompt: 'Slow zoom',
    negativePrompt: 'blur',
    params: {
      aspectRatio: '16:9',
      count: 1,
      durationSec: 5,
      resolution: '720p',
      seed: 7,
      strength: 0.4,
    },
    status: 'failed',
    progress: 20,
    cost: 15,
    outputs: [],
    input: {
      id: 'ast_input',
      kind: 'image',
      mimeType: 'image/webp',
      bytes: 10,
      url: '/api/v1/media/ast_input',
    },
    isPublic: true,
    isFavorite: false,
    createdAt: 0,
  };

  it('rebuilds the same request: tool, model, prompt, every parameter and the input image', () => {
    expect(requestFromGeneration(base)).toEqual({
      tool: 'image-to-video',
      modelId: 'aivore-demo-video',
      prompt: 'Slow zoom',
      negativePrompt: 'blur',
      params: {
        aspectRatio: '16:9',
        count: 1,
        durationSec: 5,
        resolution: '720p',
        seed: 7,
        strength: 0.4,
      },
      inputAssetId: 'ast_input',
      isPublic: false,
    });
  });

  it('never shares the new copy of a shared generation, and leaves out what was not set', () => {
    const request = requestFromGeneration({
      ...base,
      tool: 'text-to-image',
      kind: 'image',
      negativePrompt: undefined,
      input: undefined,
      params: { aspectRatio: '1:1', count: 2 },
    });
    expect(request).toEqual({
      tool: 'text-to-image',
      modelId: 'aivore-demo-video',
      prompt: 'Slow zoom',
      params: { aspectRatio: '1:1', count: 2 },
      isPublic: false,
    });
    expect(request).not.toHaveProperty('inputAssetId');
    expect(request).not.toHaveProperty('negativePrompt');
  });
});
