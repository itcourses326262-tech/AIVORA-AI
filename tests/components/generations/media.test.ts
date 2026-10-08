import { describe, expect, it } from 'vitest';
import type { AssetDTO, GenerationDTO } from '@/lib/api-types';
import {
  assetAspect,
  boundedAspect,
  downloadHref,
  estimateCardHeight,
  generationAspect,
  isActive,
  presentationOf,
  promptLabel,
  shareHref,
} from '@/lib/generations/media';

const asset = (overrides: Partial<AssetDTO> = {}): AssetDTO => ({
  id: 'ast_1',
  kind: 'image',
  mimeType: 'image/webp',
  bytes: 1000,
  url: '/api/v1/media/ast_1',
  ...overrides,
});

const generation = (overrides: Partial<GenerationDTO> = {}): GenerationDTO => ({
  id: 'gen_1',
  tool: 'text-to-image',
  kind: 'image',
  modelId: 'aivore-demo-image',
  prompt: 'a lighthouse',
  params: { aspectRatio: '16:9', count: 1 },
  status: 'queued',
  progress: 0,
  cost: 1,
  outputs: [],
  isPublic: false,
  isFavorite: false,
  createdAt: 0,
  ...overrides,
});

describe('presentationOf', () => {
  it('shows images as images', () => {
    expect(presentationOf(asset())).toBe('image');
    expect(presentationOf(asset({ mimeType: 'image/png' }))).toBe('image');
  });

  it('shows the Demo video (an animated GIF of kind video) as an <img> that animates', () => {
    expect(presentationOf(asset({ kind: 'video', mimeType: 'image/gif' }))).toBe('animated-image');
    expect(presentationOf(asset({ kind: 'image', mimeType: 'image/gif' }))).toBe('animated-image');
  });

  it('plays anything else with a video element', () => {
    expect(presentationOf(asset({ kind: 'video', mimeType: 'video/mp4' }))).toBe('video');
  });
});

describe('links', () => {
  it('asks the media route for an attachment', () => {
    expect(downloadHref(asset())).toBe('/api/v1/media/ast_1?download=1');
    expect(downloadHref(asset({ url: '/api/v1/media/ast_1?variant=thumb' }))).toBe(
      '/api/v1/media/ast_1?variant=thumb&download=1',
    );
  });

  it('builds the public share link from the origin', () => {
    expect(shareHref('https://aivore.app', 'gen_1')).toBe('https://aivore.app/s/gen_1');
  });
});

describe('aspect', () => {
  it('reads width over height when both are known', () => {
    expect(assetAspect(asset({ width: 1280, height: 720 }))).toBeCloseTo(16 / 9);
    expect(assetAspect(asset({ width: 1280 }))).toBeUndefined();
    expect(assetAspect(undefined)).toBeUndefined();
  });

  it('uses the real size of a result, then the input of an image tool, then the requested ratio', () => {
    expect(
      generationAspect(
        generation({ status: 'succeeded', outputs: [asset({ width: 1000, height: 500 })] }),
      ),
    ).toBe(2);
    expect(
      generationAspect(
        generation({ tool: 'image-to-image', input: asset({ width: 300, height: 400 }) }),
      ),
    ).toBe(0.75);
    expect(generationAspect(generation())).toBeCloseTo(16 / 9);
    // A text tool ignores a stray input.
    expect(generationAspect(generation({ input: asset({ width: 300, height: 400 }) }))).toBeCloseTo(
      16 / 9,
    );
  });

  it('keeps a box from becoming a sliver or a tower', () => {
    expect(boundedAspect(21 / 9)).toBeCloseTo(21 / 9);
    expect(boundedAspect(10)).toBe(2.4);
    expect(boundedAspect(0.1)).toBe(0.5);
  });
});

describe('estimateCardHeight', () => {
  it('grows with the number of results and follows their shape', () => {
    const one = estimateCardHeight(
      generation({ status: 'succeeded', params: { aspectRatio: '1:1', count: 1 }, outputs: [asset()] }),
      300,
    );
    const four = estimateCardHeight(
      generation({
        status: 'succeeded',
        params: { aspectRatio: '1:1', count: 4 },
        outputs: [asset(), asset(), asset(), asset()],
      }),
      300,
    );
    expect(one).toBeGreaterThan(300);
    expect(four).toBeCloseTo(one, 0);
    const wide = estimateCardHeight(
      generation({ status: 'succeeded', params: { aspectRatio: '16:9', count: 1 }, outputs: [asset()] }),
      300,
    );
    expect(wide).toBeLessThan(one);
  });

  it('gives a failed or running card a placeholder of at least the minimum height', () => {
    expect(estimateCardHeight(generation({ status: 'failed' }), 300)).toBeGreaterThan(208);
    expect(estimateCardHeight(generation({ status: 'processing' }), 100)).toBeGreaterThan(208);
  });
});

describe('isActive and promptLabel', () => {
  it('is active while queued or processing', () => {
    expect(isActive({ status: 'queued' })).toBe(true);
    expect(isActive({ status: 'processing' })).toBe(true);
    for (const status of ['succeeded', 'failed', 'canceled'] as const) {
      expect(isActive({ status })).toBe(false);
    }
  });

  it('shortens a prompt for a screen reader', () => {
    expect(promptLabel('a  b\n c')).toBe('a b c');
    expect(promptLabel('x'.repeat(200), 20)).toBe(`${'x'.repeat(20)}…`);
  });
});
