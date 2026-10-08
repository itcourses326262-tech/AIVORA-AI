import { describe, expect, it } from 'vitest';
import { getModels } from '@/lib/catalog';
import { ASPECT_RATIOS, type ModelSpec } from '@/lib/catalog/types';
import { newId } from '@/lib/id';
import { toolNeedsImage } from '@/lib/tools';
import { validateForModel, validateGenerationRequest } from '@/lib/validation/generation';
import { fullImageModel } from './fixtures';

/*
 * Models whose result keeps the proportions of the input image (`limits.followsInputAspect`): the
 * studio hides the aspect-ratio control for them, and the API accepts and ignores a ratio instead
 * of failing a request that was composed for another model.
 */

const FLAGGED = ['fal-nano-banana-pro-edit', 'fal-flux-dev-img2img', 'fal-wan-2-6-i2v'];

function model(id: string): ModelSpec {
  const found = getModels().find((candidate) => candidate.id === id);
  if (!found) throw new Error(`catalog has no model ${id}`);
  return found;
}

function request(spec: ModelSpec, aspectRatio?: unknown) {
  const tool = spec.tools[0];
  if (!tool) throw new Error('model without tools');
  return {
    tool,
    modelId: spec.id,
    prompt: 'make it look like a watercolor',
    inputAssetId: newId('ast'),
    ...(aspectRatio === undefined ? {} : { params: { aspectRatio } }),
  } as Parameters<typeof validateGenerationRequest>[0];
}

describe('the catalog flags', () => {
  it('marks exactly the fal models whose adapters ignore the aspect ratio', () => {
    const flagged = getModels()
      .filter((candidate) => candidate.limits.followsInputAspect === true)
      .map((candidate) => candidate.id);
    expect(flagged.sort()).toEqual([...FLAGGED].sort());
  });

  it('only ever sits on models that serve tools with an input image', () => {
    for (const candidate of getModels()) {
      if (candidate.limits.followsInputAspect !== true) continue;
      expect(
        candidate.tools.every((tool) => toolNeedsImage(tool)),
        candidate.id,
      ).toBe(true);
    }
  });

  it('keeps the Veo image-to-video model out: it honours the chosen ratio', () => {
    expect(model('fal-veo-3-1-fast-i2v').limits.followsInputAspect).toBeUndefined();
  });
});

describe.each(FLAGGED)('%s', (id) => {
  const spec = model(id);

  it.each(ASPECT_RATIOS)('accepts aspectRatio %s and ignores it', (ratio) => {
    const result = validateGenerationRequest(request(spec, ratio));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    // The default stays in `params`, so the stored request does not pretend to have used it.
    expect(result.params.aspectRatio).toBe(spec.limits.defaultAspectRatio);
  });

  it('prices and normalizes a request with a ratio exactly like one without', () => {
    const without = validateGenerationRequest(request(spec));
    const withRatio = validateGenerationRequest(request(spec, '21:9'));
    if (!without.ok || !withRatio.ok) throw new Error('expected both to validate');
    expect(withRatio.params).toEqual(without.params);
    expect(withRatio.cost).toBe(without.cost);
  });

  it('still refuses a value that is not an aspect ratio at all', () => {
    for (const junk of ['5:4', 'wide', 1, null, {}]) {
      const result = validateGenerationRequest(request(spec, junk));
      expect(result.ok, JSON.stringify(junk)).toBe(false);
      if (!result.ok) {
        expect(result.errors.map(({ path, code }) => ({ path, code }))).toEqual([
          { path: 'params.aspectRatio', code: 'not_allowed' },
        ]);
      }
    }
  });
});

describe('models that honour the ratio keep rejecting the ones they cannot make', () => {
  it('Wan text-to-video refuses 21:9, which Wan image-to-video would ignore', () => {
    const t2v = validateGenerationRequest({
      tool: 'text-to-video',
      modelId: 'fal-wan-2-6-t2v',
      prompt: 'a lighthouse at dusk',
      params: { aspectRatio: '21:9' },
    });
    expect(t2v.ok).toBe(false);
    if (!t2v.ok)
      expect(t2v.errors[0]).toMatchObject({ path: 'params.aspectRatio', code: 'not_allowed' });

    expect(validateGenerationRequest(request(model('fal-wan-2-6-i2v'), '21:9')).ok).toBe(true);
  });

  it('Veo image-to-video still only takes 16:9 and 9:16', () => {
    expect(validateGenerationRequest(request(model('fal-veo-3-1-fast-i2v'), '9:16')).ok).toBe(true);
    expect(validateGenerationRequest(request(model('fal-veo-3-1-fast-i2v'), '1:1')).ok).toBe(false);
  });
});

describe('a model that serves both kinds of tool', () => {
  const both: ModelSpec = {
    ...fullImageModel,
    id: 'fixture-both',
    limits: { ...fullImageModel.limits, followsInputAspect: true },
  };

  it('ignores the ratio only when the request has an input image', () => {
    const edit = validateForModel(
      {
        tool: 'image-to-image',
        modelId: both.id,
        prompt: 'restyle',
        inputAssetId: newId('ast'),
        params: { aspectRatio: '3:4' },
      },
      both,
    );
    expect(edit.ok).toBe(true);
    if (edit.ok) expect(edit.params.aspectRatio).toBe(both.limits.defaultAspectRatio);

    const fresh = validateForModel(
      { tool: 'text-to-image', modelId: both.id, prompt: 'a cat', params: { aspectRatio: '3:4' } },
      both,
    );
    expect(fresh.ok).toBe(false); // 3:4 is not in this model's list and text-to-image needs one
    const allowed = validateForModel(
      { tool: 'text-to-image', modelId: both.id, prompt: 'a cat', params: { aspectRatio: '16:9' } },
      both,
    );
    expect(allowed.ok && allowed.params.aspectRatio).toBe('16:9');
  });
});
