import { describe, expect, it } from 'vitest';
import { getModel, getModels } from '@/lib/catalog';
import { falModels } from '@/lib/catalog/models/fal';
import { mockModels } from '@/lib/catalog/models/mock';
import { openaiModels } from '@/lib/catalog/models/openai';
import { replicateModels } from '@/lib/catalog/models/replicate';
import type { ModelSpec } from '@/lib/catalog/types';
import { modelSpecProblems } from '../../helpers/model-spec';

describe('catalog registry', () => {
  it('aggregates the per-provider model files', () => {
    expect(getModels()).toEqual([...mockModels, ...openaiModels, ...falModels, ...replicateModels]);
  });

  it('hands out copies so callers cannot reorder the catalog', () => {
    const first = getModels();
    first.reverse();
    first.pop();
    expect(getModels()).toHaveLength(
      mockModels.length + openaiModels.length + falModels.length + replicateModels.length,
    );
  });

  it('returns undefined for unknown ids', () => {
    expect(getModel('does-not-exist')).toBeUndefined();
    expect(getModel('toString')).toBeUndefined();
  });

  it('looks models up by id', () => {
    for (const model of getModels()) expect(getModel(model.id)).toBe(model);
  });
});

describe('declared models', () => {
  it('are internally consistent (also guards models other owners add later)', () => {
    for (const model of getModels()) {
      expect(modelSpecProblems(model), model.id).toEqual([]);
    }
  });
});

describe('modelSpecProblems (the checker itself)', () => {
  const sound: ModelSpec = {
    id: 'sample-video',
    provider: 'mock',
    providerModel: 'sample/video',
    kind: 'video',
    tools: ['text-to-video', 'image-to-video'],
    label: 'Sample',
    description: { en: 'A sample', ar: 'نموذج تجريبي' },
    limits: {
      maxPromptChars: 500,
      aspectRatios: ['16:9', '1:1'],
      defaultAspectRatio: '16:9',
      maxCount: 1,
      defaultCount: 1,
      durations: [3, 5],
      defaultDuration: 3,
      resolutions: ['480p', '720p'],
      defaultResolution: '480p',
      supportsNegativePrompt: false,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'video', perSecond: { '480p': 2, '720p': 3 } },
  };

  it('accepts a sound spec', () => {
    expect(modelSpecProblems(sound)).toEqual([]);
  });

  it.each([
    ['bad id', { ...sound, id: 'Sample Video' }, /kebab-case/],
    ['wrong-kind tool', { ...sound, tools: ['text-to-image' as const] }, /not of kind video/],
    ['English-only description', { ...sound, description: { en: 'x', ar: 'x' } }, /Arabic/],
    [
      'default ratio not allowed',
      { ...sound, limits: { ...sound.limits, defaultAspectRatio: '9:16' as const } },
      /defaultAspectRatio/,
    ],
    [
      'default count above max',
      { ...sound, limits: { ...sound.limits, defaultCount: 2 } },
      /defaultCount/,
    ],
    ['video with count > 1', { ...sound, limits: { ...sound.limits, maxCount: 2 } }, /maxCount 1/],
    [
      'default duration not listed',
      { ...sound, limits: { ...sound.limits, defaultDuration: 4 } },
      /defaultDuration/,
    ],
    [
      'pricing of the wrong kind',
      { ...sound, pricing: { type: 'image' as const, perImage: 1 } },
      /does not match kind/,
    ],
    [
      'unpriced default resolution',
      { ...sound, pricing: { type: 'video' as const, perSecond: { '720p': 3 } } },
      /cannot be priced/,
    ],
  ])('flags %s', (_label, model, pattern) => {
    expect(modelSpecProblems(model).join('\n')).toMatch(pattern);
  });
});
