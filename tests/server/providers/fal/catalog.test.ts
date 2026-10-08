import { describe, expect, it } from 'vitest';
import { falModels } from '@/lib/catalog/models/fal';
import { computeCost } from '@/lib/catalog/pricing';
import { getModel, getModels } from '@/lib/catalog';
import { FAL_ADAPTERS } from '@/server/providers/fal/adapters';
import { falProvider } from '@/server/providers/fal';
import { modelSpecProblems } from '../../../helpers/model-spec';
import { inputFor } from './fixtures';

/** 1 credit is about USD 0.004 of upstream cost. */
const USD_PER_CREDIT = 0.004;

/** Upstream price per unit (image, or second of video) read from the model pages on 2026-10-08. */
const UPSTREAM_USD: Record<string, number | Record<string, number>> = {
  'fal-flux-schnell': 0.003,
  'fal-flux-2-pro': 0.03,
  'fal-nano-banana-pro': 0.15,
  'fal-nano-banana-pro-edit': 0.15,
  'fal-flux-dev-img2img': 0.03,
  'fal-wan-2-6-t2v': { '720p': 0.1, '1080p': 0.15 },
  'fal-wan-2-6-i2v': { '720p': 0.1, '1080p': 0.15 },
  'fal-veo-3-1-fast': { '720p': 0.15 },
  'fal-veo-3-1-fast-i2v': { '720p': 0.15 },
};

describe('fal catalog', () => {
  it('is registered with the aggregate catalog', () => {
    for (const model of falModels) {
      expect(getModel(model.id)).toBe(model);
    }
    expect(getModels().filter((model) => model.provider === 'fal')).toHaveLength(falModels.length);
  });

  it.each(falModels.map((model) => [model.id, model] as const))(
    '%s is internally consistent',
    (_id, model) => {
      expect(modelSpecProblems(model)).toEqual([]);
      expect(model.provider).toBe('fal');
    },
  );

  it('covers every tool with the planned number of models', () => {
    const serving = (tool: string) =>
      falModels.filter((model) => (model.tools as string[]).includes(tool)).length;
    expect(serving('text-to-image')).toBe(3);
    expect(serving('image-to-image')).toBe(2);
    expect(serving('text-to-video')).toBe(2);
    expect(serving('image-to-video')).toBe(2);
  });

  it('has unique, fal-prefixed ids and unique upstream endpoints', () => {
    const ids = falModels.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('fal-'))).toBe(true);
    const endpoints = falModels.map((model) => model.providerModel);
    expect(new Set(endpoints).size).toBe(endpoints.length);
  });

  it('has exactly one request adapter per model endpoint', () => {
    expect(Object.keys(FAL_ADAPTERS).sort()).toEqual(
      falModels.map((model) => model.providerModel).sort(),
    );
  });

  it('keeps the Arabic and English descriptions apart and both filled', () => {
    for (const model of falModels) {
      expect(model.description.en).toMatch(/[A-Za-z]/);
      expect(model.description.ar).toMatch(/[؀-ۿ]/);
      expect(model.description.en).not.toMatch(/[؀-ۿ]/);
    }
  });

  it('only claims a speed or audio badge where the model earns it', () => {
    const badges = (id: string) => falModels.find((model) => model.id === id)?.badges ?? [];
    expect(badges('fal-flux-schnell')).toEqual(['fast']);
    expect(badges('fal-veo-3-1-fast')).toContain('audio');
    expect(falModels.some((model) => model.badges?.includes('demo'))).toBe(false);
  });

  it('prices every model at its upstream cost per 0.004 USD, rounded up', () => {
    expect(Object.keys(UPSTREAM_USD).sort()).toEqual(falModels.map((model) => model.id).sort());
    for (const model of falModels) {
      const upstream = UPSTREAM_USD[model.id] as number | Record<string, number>;
      if (model.pricing.type === 'image') {
        expect(model.pricing.perImage).toBe(Math.ceil(Number(upstream) / USD_PER_CREDIT - 1e-9));
      } else {
        const table = upstream as Record<string, number>;
        expect(Object.keys(model.pricing.perSecond).sort()).toEqual(Object.keys(table).sort());
        for (const [resolution, usd] of Object.entries(table)) {
          expect(model.pricing.perSecond[resolution as keyof typeof model.pricing.perSecond]).toBe(
            Math.ceil(usd / USD_PER_CREDIT - 1e-9),
          );
        }
      }
    }
  });

  it('charges a whole number of credits for a typical request', () => {
    const cost = (id: string, overrides = {}) => {
      const input = inputFor(id, { params: overrides });
      return computeCost(input.model, input.params);
    };
    expect(cost('fal-flux-schnell')).toBe(1);
    expect(cost('fal-flux-schnell', { count: 4 })).toBe(4);
    expect(cost('fal-nano-banana-pro')).toBe(38);
    expect(cost('fal-wan-2-6-t2v')).toBe(125); // 5 s at 25 credits
    expect(cost('fal-wan-2-6-t2v', { durationSec: 10, resolution: '1080p' })).toBe(380);
    expect(cost('fal-veo-3-1-fast')).toBe(152); // 4 s at 38 credits
  });

  it('only advertises options the adapters send', () => {
    for (const model of falModels) {
      const { limits } = model;
      if (model.kind === 'image') expect(limits.durations).toBeUndefined();
      if (!limits.supportsSeed) expect(limits.supportsStrength).toBe(false);
    }
    const strength = falModels.filter((model) => model.limits.supportsStrength);
    expect(strength.map((model) => model.id)).toEqual(['fal-flux-dev-img2img']);
  });
});

describe('falProvider configuration', () => {
  it('is configured exactly when FAL_KEY is set', () => {
    const base = inputFor('fal-flux-schnell');
    expect(base.model.provider).toBe(falProvider.id);
    const env = (key: string | undefined) =>
      ({ FAL_KEY: key }) as Parameters<typeof falProvider.isConfigured>[0];
    expect(falProvider.isConfigured(env('test-id:test-secret'))).toBe(true);
    expect(falProvider.isConfigured(env(undefined))).toBe(false);
    expect(falProvider.isConfigured(env(''))).toBe(false);
  });
});
