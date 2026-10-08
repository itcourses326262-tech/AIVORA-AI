import { getModels } from '@/lib/catalog';
import type { ModelSpec } from '@/lib/catalog/types';

const description = { en: 'A sample model', ar: 'نموذج تجريبي' };

/** Image model that supports every option. */
export const fullImageModel: ModelSpec = {
  id: 'fixture-image-full',
  provider: 'fal',
  providerModel: 'fixture/image-full',
  kind: 'image',
  tools: ['text-to-image', 'image-to-image'],
  label: 'Fixture image (full)',
  description,
  limits: {
    maxPromptChars: 300,
    aspectRatios: ['1:1', '16:9', '9:16', '21:9'],
    defaultAspectRatio: '1:1',
    maxCount: 4,
    defaultCount: 2,
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsStrength: true,
  },
  pricing: { type: 'image', perImage: 3 },
};

/** Image model with the fewest options: no negative prompt, seed or strength, one image. */
export const minimalImageModel: ModelSpec = {
  id: 'fixture-image-minimal',
  provider: 'openai',
  providerModel: 'fixture/image-minimal',
  kind: 'image',
  tools: ['text-to-image'],
  label: 'Fixture image (minimal)',
  description,
  limits: {
    maxPromptChars: 40,
    aspectRatios: ['1:1', '3:2'],
    defaultAspectRatio: '3:2',
    maxCount: 1,
    defaultCount: 1,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsStrength: false,
  },
  pricing: { type: 'image', perImage: 0.5 },
};

/** Video model with durations and resolutions and every option. */
export const fullVideoModel: ModelSpec = {
  id: 'fixture-video-full',
  provider: 'replicate',
  providerModel: 'fixture/video-full',
  kind: 'video',
  tools: ['text-to-video', 'image-to-video'],
  label: 'Fixture video (full)',
  description,
  limits: {
    maxPromptChars: 500,
    aspectRatios: ['16:9', '9:16'],
    defaultAspectRatio: '16:9',
    maxCount: 1,
    defaultCount: 1,
    durations: [3, 5, 10],
    defaultDuration: 5,
    resolutions: ['480p', '720p', '1080p'],
    defaultResolution: '720p',
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsStrength: true,
  },
  pricing: { type: 'video', perSecond: { '480p': 2, '720p': 3, '1080p': 5 } },
};

/** Image-to-video only, no optional features, defaults taken from the first list entries. */
export const minimalVideoModel: ModelSpec = {
  id: 'fixture-video-minimal',
  provider: 'fal',
  providerModel: 'fixture/video-minimal',
  kind: 'video',
  tools: ['image-to-video'],
  label: 'Fixture video (minimal)',
  description,
  limits: {
    maxPromptChars: 200,
    aspectRatios: ['16:9'],
    defaultAspectRatio: '16:9',
    maxCount: 1,
    defaultCount: 1,
    durations: [4],
    resolutions: ['480p'],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsStrength: false,
  },
  pricing: { type: 'video', perSecond: { '480p': 1.5 } },
};

export const fixtureModels: readonly ModelSpec[] = [
  fullImageModel,
  minimalImageModel,
  fullVideoModel,
  minimalVideoModel,
];

/** Fixtures plus whatever the real catalog declares today, so new models are covered automatically. */
export function modelsUnderTest(): ModelSpec[] {
  return [...fixtureModels, ...getModels()];
}
