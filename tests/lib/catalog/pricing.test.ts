import { describe, expect, it } from 'vitest';
import { computeCost } from '@/lib/catalog/pricing';
import type { GenerationParams, ModelSpec } from '@/lib/catalog/types';

function model(overrides: Partial<ModelSpec>): ModelSpec {
  return {
    id: 'test-model',
    provider: 'mock',
    providerModel: 'test/model',
    kind: 'image',
    tools: ['text-to-image'],
    label: 'Test',
    description: { en: 'Test', ar: 'اختبار' },
    limits: {
      maxPromptChars: 1000,
      aspectRatios: ['1:1'],
      defaultAspectRatio: '1:1',
      maxCount: 4,
      defaultCount: 1,
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsStrength: false,
    },
    pricing: { type: 'image', perImage: 1 },
    ...overrides,
  };
}

const imageParams = (count: number): GenerationParams => ({ aspectRatio: '1:1', count });

const video = model({
  kind: 'video',
  tools: ['text-to-video'],
  limits: {
    maxPromptChars: 1000,
    aspectRatios: ['16:9'],
    defaultAspectRatio: '16:9',
    maxCount: 1,
    defaultCount: 1,
    durations: [3, 5],
    defaultDuration: 3,
    resolutions: ['480p', '720p'],
    defaultResolution: '480p',
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsStrength: false,
  },
  pricing: { type: 'video', perSecond: { '480p': 2, '720p': 3 } },
});

describe('computeCost: images', () => {
  it('charges per image times count', () => {
    const cheap = model({ pricing: { type: 'image', perImage: 1 } });
    expect(computeCost(cheap, imageParams(1))).toBe(1);
    expect(computeCost(cheap, imageParams(4))).toBe(4);
    const dear = model({ pricing: { type: 'image', perImage: 3 } });
    expect(computeCost(dear, imageParams(3))).toBe(9);
  });

  it('rounds fractional prices up', () => {
    expect(computeCost(model({ pricing: { type: 'image', perImage: 0.5 } }), imageParams(3))).toBe(
      2,
    );
  });

  it('never charges less than one credit', () => {
    expect(computeCost(model({ pricing: { type: 'image', perImage: 0.1 } }), imageParams(1))).toBe(
      1,
    );
    expect(computeCost(model({ pricing: { type: 'image', perImage: 0 } }), imageParams(1))).toBe(1);
  });

  it('is not tricked by floating point noise', () => {
    // 0.7 * 10 is 7.000000000000001 in binary floating point; it must cost 7, not 8.
    expect(computeCost(model({ pricing: { type: 'image', perImage: 0.7 } }), imageParams(10))).toBe(
      7,
    );
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid count (%s)', (count) => {
    expect(() => computeCost(model({}), imageParams(count))).toThrow(RangeError);
  });
});

describe('computeCost: video', () => {
  it('charges per second at the requested resolution', () => {
    expect(
      computeCost(video, { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '720p' }),
    ).toBe(15);
    expect(
      computeCost(video, { aspectRatio: '16:9', count: 1, durationSec: 3, resolution: '480p' }),
    ).toBe(6);
  });

  it('falls back to the default duration and resolution', () => {
    expect(computeCost(video, { aspectRatio: '16:9', count: 1 })).toBe(6);
  });

  it('falls back to the first listed duration when there is no default', () => {
    const noDefault = model({
      ...video,
      limits: { ...video.limits, defaultDuration: undefined },
    });
    expect(computeCost(noDefault, { aspectRatio: '16:9', count: 1 })).toBe(6);
  });

  it('multiplies by count', () => {
    expect(
      computeCost(video, { aspectRatio: '16:9', count: 2, durationSec: 5, resolution: '480p' }),
    ).toBe(20);
  });

  it('throws when the model has no price for the resolution', () => {
    expect(() =>
      computeCost(video, { aspectRatio: '16:9', count: 1, durationSec: 3, resolution: '1080p' }),
    ).toThrow(/no price for resolution 1080p/);
  });

  it('throws when neither params nor model defaults say how long or how sharp', () => {
    const bare = model({
      ...video,
      limits: {
        ...video.limits,
        durations: undefined,
        defaultDuration: undefined,
        defaultResolution: undefined,
      },
    });
    expect(() => computeCost(bare, { aspectRatio: '16:9', count: 1 })).toThrow(
      /resolution and a duration/,
    );
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a bad duration (%s)',
    (durationSec) => {
      expect(() =>
        computeCost(video, { aspectRatio: '16:9', count: 1, durationSec, resolution: '480p' }),
      ).toThrow(RangeError);
    },
  );

  it('is pure: the same input always gives the same cost and mutates nothing', () => {
    const params: GenerationParams = {
      aspectRatio: '16:9',
      count: 1,
      durationSec: 5,
      resolution: '720p',
    };
    const snapshot = JSON.stringify({ video, params });
    expect(computeCost(video, params)).toBe(computeCost(video, params));
    expect(JSON.stringify({ video, params })).toBe(snapshot);
  });
});
