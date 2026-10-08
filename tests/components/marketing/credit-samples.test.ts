import { describe, expect, it } from 'vitest';
import type { ModelSpec } from '@/lib/catalog/types';
import { getModels } from '@/lib/catalog';
import { pickCreditSamples } from '@/components/marketing/credit-samples';

function model(
  overrides: Partial<ModelSpec> & Pick<ModelSpec, 'id' | 'kind' | 'pricing'>,
): ModelSpec {
  const video = overrides.kind === 'video';
  return {
    provider: 'fal',
    providerModel: `up/${overrides.id}`,
    tools: [video ? 'text-to-video' : 'text-to-image'],
    label: overrides.id,
    description: { en: 'x', ar: 'س' },
    limits: {
      maxPromptChars: 100,
      aspectRatios: ['1:1', '16:9'],
      defaultAspectRatio: '1:1',
      maxCount: 1,
      defaultCount: 1,
      ...(video
        ? {
            durations: [4, 8],
            defaultDuration: 4,
            resolutions: ['480p', '720p'] as ModelSpec['limits']['resolutions'],
            defaultResolution: '720p' as const,
          }
        : {}),
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsStrength: false,
    },
    ...overrides,
  };
}

const image = (id: string, perImage: number, extra: Partial<ModelSpec> = {}) =>
  model({ id, kind: 'image', pricing: { type: 'image', perImage }, ...extra });

describe('pickCreditSamples', () => {
  it('prices one generation with the default settings, cheapest first', () => {
    const video = model({
      id: 'clip',
      kind: 'video',
      pricing: { type: 'video', perSecond: { '480p': 2, '720p': 5 } },
    });
    const { images, videos } = pickCreditSamples([image('b', 8), image('a', 1), video]);
    expect(images.map((sample) => [sample.id, sample.credits])).toEqual([
      ['a', 1],
      ['b', 8],
    ]);
    // 4 seconds at the default 720p, 5 credits per second.
    expect(videos).toEqual([
      { id: 'clip', label: 'clip', credits: 20, seconds: 4, resolution: '720p' },
    ]);
  });

  it('keeps the cheapest, a middle and the dearest entry when there are more than three', () => {
    const models = [1, 2, 3, 4, 5].map((n) => image(`m${n}`, n * 10));
    expect(pickCreditSamples(models).images.map((sample) => sample.credits)).toEqual([10, 30, 50]);
  });

  it('leaves the Demo models out when real ones exist, and uses them when they are all there is', () => {
    const demo = image('demo', 1, { badges: ['demo'], provider: 'mock' });
    expect(pickCreditSamples([demo, image('real', 8)]).images.map((s) => s.id)).toEqual(['real']);
    expect(pickCreditSamples([demo]).images.map((s) => s.id)).toEqual(['demo']);
  });

  it('lists a model once even when several tools serve it, at its lowest price', () => {
    const samples = pickCreditSamples([
      image('wan-a', 9, { label: 'Wan' }),
      image('wan-b', 4, { label: 'Wan' }),
    ]);
    expect(samples.images).toEqual([{ id: 'wan-b', label: 'Wan', credits: 4 }]);
  });

  it('only counts models of the text-to-image and text-to-video tools', () => {
    const edit = image('edit', 3, { tools: ['image-to-image'] });
    expect(pickCreditSamples([edit]).images).toEqual([]);
  });

  it('skips a video model that cannot be priced from its defaults', () => {
    const broken = model({
      id: 'broken',
      kind: 'video',
      pricing: { type: 'video', perSecond: {} },
      limits: { ...image('x', 1).limits },
    });
    expect(pickCreditSamples([broken]).videos).toEqual([]);
  });

  it('works on the real catalog: both kinds have prices and every one is a positive whole number', () => {
    const { images, videos } = pickCreditSamples(getModels());
    expect(images.length).toBeGreaterThan(0);
    expect(videos.length).toBeGreaterThan(0);
    for (const sample of [...images, ...videos]) {
      expect(Number.isInteger(sample.credits)).toBe(true);
      expect(sample.credits).toBeGreaterThan(0);
    }
  });
});
