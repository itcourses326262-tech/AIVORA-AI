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

  const soundImage: ModelSpec = {
    ...sound,
    id: 'sample-image',
    kind: 'image',
    tools: ['text-to-image'],
    limits: {
      ...sound.limits,
      maxCount: 4,
      defaultCount: 1,
      durations: undefined,
      defaultDuration: undefined,
      resolutions: undefined,
      defaultResolution: undefined,
    },
    pricing: { type: 'image', perImage: 2 },
  };

  it('accepts a sound image spec', () => {
    expect(modelSpecProblems(soundImage)).toEqual([]);
  });

  it('prices every duration at every resolution a video model allows, not only the default', () => {
    // 1080p is selectable but unpriced: validation would accept it and computeCost would throw.
    const unpricedTier: ModelSpec = {
      ...sound,
      limits: { ...sound.limits, resolutions: ['480p', '720p', '1080p'] },
      pricing: { type: 'video', perSecond: { '480p': 2 } },
    };
    const problems = modelSpecProblems(unpricedTier);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/3s 720p request cannot be priced.*720p/),
        expect.stringMatching(/5s 1080p request cannot be priced.*1080p/),
      ]),
    );
    expect(problems.some((problem) => problem.includes('480p'))).toBe(false);
    // The default request (3s, 480p) is priced, which is all the old check looked at.
    expect(problems.some((problem) => problem.startsWith('default request'))).toBe(false);
  });

  it('requires video models to list durations and resolutions', () => {
    const problems = modelSpecProblems({
      ...sound,
      limits: { ...sound.limits, durations: [], resolutions: undefined },
    });
    expect(problems.join('\n')).toMatch(/must list durations/);
    expect(problems.join('\n')).toMatch(/must list resolutions/);
  });

  it.each([5, 9, 0, 2.5])(
    'flags an image model with maxCount %s (the contract is 1-4)',
    (maxCount) => {
      const model: ModelSpec = { ...soundImage, limits: { ...soundImage.limits, maxCount } };
      expect(modelSpecProblems(model).join('\n')).toMatch(/maxCount from 1 to 4/);
    },
  );

  it('flags an image price that rounds to nothing usable', () => {
    const model: ModelSpec = { ...soundImage, pricing: { type: 'image', perImage: Number.NaN } };
    expect(modelSpecProblems(model).join('\n')).toMatch(/costs NaN/);
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
