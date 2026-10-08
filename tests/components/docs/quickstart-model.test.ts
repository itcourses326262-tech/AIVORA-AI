import { describe, expect, it } from 'vitest';
import { pickQuickstartModel } from '@/components/docs/quickstart-model';
import type { ModelDTO } from '@/lib/api-types';
import { getModels } from '@/lib/catalog';

function dto(id: string, overrides: Partial<ModelDTO> = {}): ModelDTO {
  const spec = getModels().find((model) => model.id === id);
  if (!spec) throw new Error(`no model ${id}`);
  const { providerModel: _providerModel, ...rest } = spec;
  return { ...rest, available: true, ...overrides };
}

describe('pickQuickstartModel', () => {
  it('takes the first available text-to-image model and prices one image', () => {
    const picked = pickQuickstartModel([dto('aivore-demo-video'), dto('aivore-demo-image')]);
    expect(picked).toEqual({
      modelId: 'aivore-demo-image',
      aspectRatio: '16:9',
      cost: 1,
      usable: true,
    });
  });

  it('skips a model that cannot run here when another can', () => {
    const picked = pickQuickstartModel([
      dto('aivore-demo-image', { available: false, unavailableReason: 'not_configured' }),
      dto('fal-flux-schnell'),
    ]);
    expect(picked?.modelId).toBe('fal-flux-schnell');
    expect(picked?.usable).toBe(true);
  });

  it('falls back to a model that is not available, and says so', () => {
    const picked = pickQuickstartModel([
      dto('aivore-demo-image', { available: false, unavailableReason: 'not_configured' }),
    ]);
    expect(picked).toMatchObject({ modelId: 'aivore-demo-image', usable: false });
  });

  it('falls back to the default ratio of a model without 16:9', () => {
    const base = dto('aivore-demo-image');
    const picked = pickQuickstartModel([
      {
        ...base,
        limits: { ...base.limits, aspectRatios: ['1:1', '4:3'], defaultAspectRatio: '1:1' },
      },
    ]);
    expect(picked?.aspectRatio).toBe('1:1');
  });

  it('has nothing to pick without an image model', () => {
    expect(pickQuickstartModel([dto('aivore-demo-video')])).toBeUndefined();
    expect(pickQuickstartModel([])).toBeUndefined();
  });
});
