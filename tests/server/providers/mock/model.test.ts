import { describe, expect, it } from 'vitest';
import { getModel, getModels } from '@/lib/catalog';
import { mockModels } from '@/lib/catalog/models/mock';
import { computeCost } from '@/lib/catalog/pricing';
import { getTool } from '@/lib/tools';
import { parseEnv } from '@/server/env';
import { getProvider, isProviderAvailable } from '@/server/providers/registry';
import { mockProvider } from '@/server/providers/mock';
import { modelSpecProblems } from '../../../helpers/model-spec';
import { IMAGE_MODEL, VIDEO_MODEL } from './fixtures';

const env = (extra: Record<string, string> = {}) =>
  parseEnv({ SESSION_SECRET: 's'.repeat(40), ...extra });

describe('demo model specs', () => {
  it('declares exactly the two demo models, all served by the mock provider', () => {
    expect(mockModels.map((model) => model.id)).toEqual(['aivore-demo-image', 'aivore-demo-video']);
    for (const model of mockModels) {
      expect(model.provider).toBe('mock');
      expect(model.badges).toEqual(['demo']);
    }
  });

  it.each(mockModels.map((model) => [model.id, model] as const))(
    '%s is internally consistent',
    (_id, model) => {
      expect(modelSpecProblems(model)).toEqual([]);
    },
  );

  it('prices images at 1 credit each and video at 2 (480p) or 3 (720p) credits per second', () => {
    const image = { aspectRatio: '1:1', count: 4 } as const;
    expect(computeCost(IMAGE_MODEL, image)).toBe(4);
    const video = { aspectRatio: '16:9', count: 1 } as const;
    expect(computeCost(VIDEO_MODEL, { ...video, durationSec: 3, resolution: '480p' })).toBe(6);
    expect(computeCost(VIDEO_MODEL, { ...video, durationSec: 5, resolution: '480p' })).toBe(10);
    expect(computeCost(VIDEO_MODEL, { ...video, durationSec: 3, resolution: '720p' })).toBe(9);
    expect(computeCost(VIDEO_MODEL, { ...video, durationSec: 5, resolution: '720p' })).toBe(15);
  });

  it('serves the four tools with the limits of the brief', () => {
    expect(IMAGE_MODEL.tools).toEqual(['text-to-image', 'image-to-image']);
    expect(VIDEO_MODEL.tools).toEqual(['text-to-video', 'image-to-video']);
    expect(IMAGE_MODEL.limits).toMatchObject({
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
      maxCount: 4,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsStrength: true,
    });
    expect(VIDEO_MODEL.limits).toMatchObject({
      durations: [3, 5],
      resolutions: ['480p', '720p'],
      maxCount: 1,
      supportsSeed: true,
    });
    for (const model of mockModels) {
      for (const tool of model.tools) expect(getTool(tool)?.kind).toBe(model.kind);
    }
  });

  it('has real Arabic and English descriptions', () => {
    for (const model of mockModels) {
      expect(model.description.en).toMatch(/[A-Za-z]+ [A-Za-z]+ [A-Za-z]+ [A-Za-z]+/);
      expect(model.description.ar).toMatch(/[؀-ۿ]{3}/);
      expect(model.description.ar).not.toMatch(/[A-Za-z]{4}/);
    }
  });

  it('is part of the catalog', () => {
    expect(getModel('aivore-demo-image')).toBe(IMAGE_MODEL);
    expect(getModels().filter((model) => model.provider === 'mock')).toHaveLength(2);
  });
});

describe('mock provider registration', () => {
  it('is the provider the registry resolves for "mock"', () => {
    expect(getProvider('mock')).toBe(mockProvider);
    expect(mockProvider.id).toBe('mock');
  });

  it('is configured exactly when ENABLE_MOCK_PROVIDER is on', () => {
    expect(mockProvider.isConfigured(env({ ENABLE_MOCK_PROVIDER: 'true' }))).toBe(true);
    expect(mockProvider.isConfigured(env({ ENABLE_MOCK_PROVIDER: 'false' }))).toBe(false);
    expect(isProviderAvailable('mock', env({ ENABLE_MOCK_PROVIDER: 'false' }))).toBe(false);
  });

  it('supports cancel without effect', async () => {
    const cancel = mockProvider.cancel;
    expect(cancel).toBeTypeOf('function');
    await expect(
      cancel?.('mock_job', { signal: new AbortController().signal } as never),
    ).resolves.toBeUndefined();
  });
});
