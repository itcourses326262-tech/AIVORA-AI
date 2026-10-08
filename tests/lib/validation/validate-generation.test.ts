import { describe, expect, it } from 'vitest';
import type { CreateGenerationRequest } from '@/lib/api-types';
import { computeCost, getModel } from '@/lib/catalog';
import {
  ASPECT_RATIOS,
  RESOLUTIONS,
  TOOLS,
  type GenerationParams,
  type ModelSpec,
  type Tool,
} from '@/lib/catalog/types';
import { newId } from '@/lib/id';
import { getTool } from '@/lib/tools';
import {
  defaultParamsFor,
  validateForModel,
  validateGenerationRequest,
  type GenerationValidationCode,
  type GenerationValidationResult,
} from '@/lib/validation/generation';
import {
  fixtureModels,
  fullImageModel,
  fullVideoModel,
  minimalImageModel,
  minimalVideoModel,
  modelsUnderTest,
} from './fixtures';

function run(model: ModelSpec, request: CreateGenerationRequest): GenerationValidationResult {
  return getModel(model.id) === model
    ? validateGenerationRequest(request)
    : validateForModel(request, model);
}

function needsImage(tool: Tool): boolean {
  return getTool(tool)?.needsInputImage === true;
}

function baseRequest(model: ModelSpec, tool: Tool): CreateGenerationRequest {
  return {
    tool,
    modelId: model.id,
    prompt: 'a red fox in the snow',
    ...(needsImage(tool) ? { inputAssetId: newId('ast') } : {}),
  };
}

function issuesOf(result: GenerationValidationResult) {
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors.map(({ path, code }) => ({ path, code }));
}

describe('validateGenerationRequest', () => {
  it('fills defaults, trims the prompt and prices the request', () => {
    const result = validateForModel(
      { tool: 'text-to-image', modelId: fullImageModel.id, prompt: '  a cat  ' },
      fullImageModel,
    );
    expect(result).toEqual({
      ok: true,
      model: fullImageModel,
      prompt: 'a cat',
      params: { aspectRatio: '1:1', count: 2 },
      cost: 6,
    });
  });

  it('fills the default duration and resolution of a video model', () => {
    const result = validateForModel(
      { tool: 'text-to-video', modelId: fullVideoModel.id, prompt: 'waves' },
      fullVideoModel,
    );
    expect(result).toMatchObject({
      ok: true,
      params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '720p' },
      cost: 15,
    });
  });

  it('falls back to the first listed duration and resolution when no default is declared', () => {
    const result = validateForModel(
      { tool: 'image-to-video', modelId: minimalVideoModel.id, prompt: 'p', inputAssetId: 'ast_x' },
      minimalVideoModel,
    );
    expect(result).toMatchObject({
      ok: true,
      params: { durationSec: 4, resolution: '480p' },
      cost: 6,
    });
  });

  it('never prices below one credit', () => {
    const result = validateForModel(
      { tool: 'text-to-image', modelId: minimalImageModel.id, prompt: 'a' },
      minimalImageModel,
    );
    expect(result).toMatchObject({ ok: true, cost: 1 });
  });

  it('keeps only the options the request named, normalized', () => {
    const result = validateForModel(
      {
        tool: 'image-to-image',
        modelId: fullImageModel.id,
        prompt: ' p ',
        negativePrompt: '  blurry  ',
        inputAssetId: newId('ast'),
        params: { aspectRatio: '21:9', count: 4, seed: 0, strength: 0 },
      },
      fullImageModel,
    );
    expect(result).toMatchObject({
      ok: true,
      prompt: 'p',
      negativePrompt: 'blurry',
      params: { aspectRatio: '21:9', count: 4, seed: 0, strength: 0 },
      cost: 12,
    });
  });

  it('treats a blank negative prompt as absent, even for a model without support', () => {
    for (const model of [fullImageModel, minimalImageModel]) {
      const result = validateForModel(
        { tool: 'text-to-image', modelId: model.id, prompt: 'p', negativePrompt: '   ' },
        model,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result).not.toHaveProperty('negativePrompt');
    }
  });

  it('does not mutate the request', () => {
    const request: CreateGenerationRequest = {
      tool: 'text-to-image',
      modelId: fullImageModel.id,
      prompt: '  x ',
      params: { count: 3 },
    };
    const snapshot = structuredClone(request);
    validateForModel(request, fullImageModel);
    expect(request).toEqual(snapshot);
  });

  describe('model and tool', () => {
    it('rejects an unknown model', () => {
      expect(
        issuesOf(
          validateGenerationRequest({ tool: 'text-to-image', modelId: 'nope', prompt: 'p' }),
        ),
      ).toEqual([{ path: 'modelId', code: 'unknown_model' }]);
    });

    it('does not trust prototype keys as model ids', () => {
      for (const modelId of ['toString', '__proto__', 'constructor']) {
        expect(
          issuesOf(validateGenerationRequest({ tool: 'text-to-image', modelId, prompt: 'p' })),
        ).toEqual([{ path: 'modelId', code: 'unknown_model' }]);
      }
    });

    it('rejects an unknown tool', () => {
      const request = { tool: 'text-to-audio', modelId: 'x', prompt: 'p' };
      expect(
        issuesOf(validateGenerationRequest(request as unknown as CreateGenerationRequest)),
      ).toEqual(expect.arrayContaining([{ path: 'tool', code: 'unknown_tool' }]));
    });

    it('rejects a model that does not serve the tool', () => {
      expect(
        issuesOf(
          validateForModel(
            {
              tool: 'image-to-image',
              modelId: minimalImageModel.id,
              prompt: 'p',
              inputAssetId: 'a',
            },
            minimalImageModel,
          ),
        ),
      ).toEqual([{ path: 'modelId', code: 'model_tool_mismatch' }]);
      expect(
        issuesOf(
          validateForModel(
            { tool: 'text-to-video', modelId: minimalImageModel.id, prompt: 'p' },
            minimalImageModel,
          ),
        ),
      ).toEqual([{ path: 'modelId', code: 'model_tool_mismatch' }]);
    });

    it('hides Demo models when ENABLE_MOCK_PROVIDER is false', () => {
      const demo = getModel('aivore-demo-image');
      if (!demo) return; // the Demo catalog entry is owned by providers-mock
      const request = { tool: 'text-to-image' as const, modelId: demo.id, prompt: 'p' };
      expect(validateGenerationRequest(request).ok).toBe(true);
      expect(validateGenerationRequest(request, { ENABLE_MOCK_PROVIDER: true }).ok).toBe(true);
      expect(issuesOf(validateGenerationRequest(request, { ENABLE_MOCK_PROVIDER: false }))).toEqual(
        [{ path: 'modelId', code: 'unknown_model' }],
      );
    });
  });

  describe('prompt', () => {
    it.each([
      ['empty', ''],
      ['blank', ' \n\t '],
    ])('rejects a %s prompt', (_label, prompt) => {
      expect(
        issuesOf(
          validateForModel(
            { tool: 'text-to-image', modelId: fullImageModel.id, prompt },
            fullImageModel,
          ),
        ),
      ).toEqual([{ path: 'prompt', code: 'required' }]);
    });

    it.each([
      ['zero-width spaces', '\u200b\u200b'],
      ['a zero-width joiner and a word joiner', '\u200d\u2060'],
      ['a byte-order mark', '\ufeff'],
      ['a soft hyphen', '\u00ad'],
      ['bidi controls', '\u202e\u200f'],
      ['a Hangul filler and a blank Braille cell', '\u3164\u2800'],
      ['variation selectors', '\ufe0f\ufe0e'],
      ['invisible characters between spaces', ' \u200b \n \u200c '],
    ])('rejects a prompt made only of %s as empty', (_label, prompt) => {
      expect(
        issuesOf(
          validateForModel(
            { tool: 'text-to-image', modelId: fullImageModel.id, prompt },
            fullImageModel,
          ),
        ),
      ).toEqual([{ path: 'prompt', code: 'required' }]);
    });

    it('keeps zero-width characters that sit inside real text', () => {
      // The Persian/Arabic zero-width non-joiner and emoji joiners are part of the writing.
      const prompt = 'می\u200cخواهم یک گربه';
      const result = validateForModel(
        { tool: 'text-to-image', modelId: fullImageModel.id, prompt },
        fullImageModel,
      );
      expect(result.ok && result.prompt).toBe(prompt);
    });

    it('accepts exactly the model limit and rejects one more, counting trimmed characters', () => {
      const limit = minimalImageModel.limits.maxPromptChars;
      const at = validateForModel(
        { tool: 'text-to-image', modelId: minimalImageModel.id, prompt: ` ${'x'.repeat(limit)} ` },
        minimalImageModel,
      );
      expect(at.ok).toBe(true);
      const over = validateForModel(
        { tool: 'text-to-image', modelId: minimalImageModel.id, prompt: 'x'.repeat(limit + 1) },
        minimalImageModel,
      );
      expect(issuesOf(over)).toEqual([{ path: 'prompt', code: 'too_long' }]);
    });

    it('counts characters, not UTF-16 units (emoji and Arabic)', () => {
      const limit = minimalImageModel.limits.maxPromptChars;
      expect(
        validateForModel(
          { tool: 'text-to-image', modelId: minimalImageModel.id, prompt: '😀'.repeat(limit) },
          minimalImageModel,
        ).ok,
      ).toBe(true);
      expect(
        validateForModel(
          { tool: 'text-to-image', modelId: minimalImageModel.id, prompt: 'ق'.repeat(limit) },
          minimalImageModel,
        ).ok,
      ).toBe(true);
    });

    it('mentions the limit in the message', () => {
      const result = validateForModel(
        { tool: 'text-to-image', modelId: minimalImageModel.id, prompt: 'x'.repeat(41) },
        minimalImageModel,
      );
      if (result.ok) throw new Error('expected failure');
      expect(result.errors[0]?.message).toContain('40');
    });
  });

  describe('negative prompt', () => {
    it('is rejected for a model without support, naming the field', () => {
      const result = validateForModel(
        {
          tool: 'text-to-image',
          modelId: minimalImageModel.id,
          prompt: 'p',
          negativePrompt: 'blurry',
        },
        minimalImageModel,
      );
      expect(issuesOf(result)).toEqual([{ path: 'negativePrompt', code: 'unsupported' }]);
    });

    it.each(['', '   ', '\u200b\u200b', ' \u200d \n'])(
      'treats %j as no negative prompt at all',
      (negativePrompt) => {
        for (const model of [minimalImageModel, fullImageModel]) {
          const result = validateForModel(
            { tool: 'text-to-image', modelId: model.id, prompt: 'p', negativePrompt },
            model,
          );
          expect(result.ok).toBe(true);
          expect(result.ok && 'negativePrompt' in result).toBe(false);
        }
      },
    );

    it('is limited to the model prompt length when supported', () => {
      const result = validateForModel(
        {
          tool: 'text-to-image',
          modelId: fullImageModel.id,
          prompt: 'p',
          negativePrompt: 'x'.repeat(fullImageModel.limits.maxPromptChars + 1),
        },
        fullImageModel,
      );
      expect(issuesOf(result)).toEqual([{ path: 'negativePrompt', code: 'too_long' }]);
    });
  });

  describe('input image', () => {
    it('is required by image-to-image and image-to-video', () => {
      expect(
        issuesOf(
          validateForModel(
            { tool: 'image-to-image', modelId: fullImageModel.id, prompt: 'p' },
            fullImageModel,
          ),
        ),
      ).toEqual([{ path: 'inputAssetId', code: 'required' }]);
      expect(
        issuesOf(
          validateForModel(
            { tool: 'image-to-video', modelId: fullVideoModel.id, prompt: 'p' },
            fullVideoModel,
          ),
        ),
      ).toEqual([{ path: 'inputAssetId', code: 'required' }]);
    });

    it('is rejected by text-to-image and text-to-video', () => {
      expect(
        issuesOf(
          validateForModel(
            {
              tool: 'text-to-image',
              modelId: fullImageModel.id,
              prompt: 'p',
              inputAssetId: newId('ast'),
            },
            fullImageModel,
          ),
        ),
      ).toEqual([{ path: 'inputAssetId', code: 'unsupported' }]);
      expect(
        issuesOf(
          validateForModel(
            {
              tool: 'text-to-video',
              modelId: fullVideoModel.id,
              prompt: 'p',
              inputAssetId: newId('ast'),
            },
            fullVideoModel,
          ),
        ),
      ).toEqual([{ path: 'inputAssetId', code: 'unsupported' }]);
    });
  });

  describe('strength', () => {
    it('applies only to tools with an input image', () => {
      expect(
        issuesOf(
          validateForModel(
            {
              tool: 'text-to-image',
              modelId: fullImageModel.id,
              prompt: 'p',
              params: { strength: 0.5 },
            },
            fullImageModel,
          ),
        ),
      ).toEqual([{ path: 'params.strength', code: 'unsupported' }]);
    });
  });

  describe('robustness', () => {
    it('reports every problem at once, in request-field order', () => {
      const result = validateForModel(
        {
          tool: 'text-to-image',
          modelId: minimalImageModel.id,
          prompt: '',
          negativePrompt: 'x',
          params: { aspectRatio: '21:9', count: 9, seed: 1 },
          inputAssetId: newId('ast'),
        },
        minimalImageModel,
      );
      expect(issuesOf(result)).toEqual([
        { path: 'prompt', code: 'required' },
        { path: 'negativePrompt', code: 'unsupported' },
        { path: 'params.aspectRatio', code: 'not_allowed' },
        { path: 'params.count', code: 'out_of_range' },
        { path: 'params.seed', code: 'unsupported' },
        { path: 'inputAssetId', code: 'unsupported' },
      ]);
    });

    it('still reports field problems when the model is unknown', () => {
      const result = validateGenerationRequest({
        tool: 'text-to-image',
        modelId: 'nope',
        prompt: ' ',
        inputAssetId: newId('ast'),
        params: { count: 1 },
      });
      expect(issuesOf(result)).toEqual([
        { path: 'modelId', code: 'unknown_model' },
        { path: 'prompt', code: 'required' },
        { path: 'inputAssetId', code: 'unsupported' },
      ]);
    });

    it('rejects unknown request fields and parameters', () => {
      const result = validateForModel(
        {
          tool: 'text-to-image',
          modelId: fullImageModel.id,
          prompt: 'p',
          style: 'anime',
          params: { quality: 'hd' },
        } as unknown as CreateGenerationRequest,
        fullImageModel,
      );
      expect(issuesOf(result)).toEqual([
        { path: 'style', code: 'unknown_field' },
        { path: 'params.quality', code: 'unknown_field' },
      ]);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'text'],
      ['a number', 42],
      ['an array', []],
    ])('reports %s instead of throwing', (_label, input) => {
      const result = validateGenerationRequest(input as unknown as CreateGenerationRequest);
      expect(result.ok).toBe(false);
    });

    it('survives hostile field types', () => {
      const hostile = [
        null,
        0,
        1.5,
        NaN,
        Infinity,
        '',
        'x',
        true,
        [],
        {},
        () => 1,
        Symbol.iterator,
      ];
      const fields = [
        'tool',
        'modelId',
        'prompt',
        'negativePrompt',
        'params',
        'inputAssetId',
        'isPublic',
      ];
      for (const field of fields) {
        for (const value of hostile) {
          const request = {
            tool: 'text-to-image',
            modelId: fullImageModel.id,
            prompt: 'p',
            [field]: value,
          };
          expect(() =>
            validateForModel(request as unknown as CreateGenerationRequest, fullImageModel),
          ).not.toThrow();
        }
      }
      for (const key of ['aspectRatio', 'count', 'durationSec', 'resolution', 'seed', 'strength']) {
        for (const value of hostile) {
          const request = {
            tool: 'text-to-image',
            modelId: fullImageModel.id,
            prompt: 'p',
            params: { [key]: value },
          };
          expect(() =>
            validateForModel(request as unknown as CreateGenerationRequest, fullImageModel),
          ).not.toThrow();
        }
      }
    });

    it('reports a catalog entry that cannot be priced instead of throwing', () => {
      const unpriced: ModelSpec = {
        ...fullVideoModel,
        id: 'fixture-video-unpriced',
        pricing: { type: 'video', perSecond: { '480p': 2 } },
      };
      const result = validateForModel(
        {
          tool: 'text-to-video',
          modelId: unpriced.id,
          prompt: 'p',
          params: { resolution: '1080p' },
        },
        unpriced,
      );
      expect(issuesOf(result)).toEqual([{ path: 'params', code: 'unpriced' }]);
    });
  });
});

describe('with the Demo models of the catalog', () => {
  it('prices the documented defaults: 1 credit per image, 2 or 3 per video second', () => {
    expect(
      validateGenerationRequest({
        tool: 'text-to-image',
        modelId: 'aivore-demo-image',
        prompt: 'p',
      }),
    ).toMatchObject({ ok: true, cost: 1, params: { aspectRatio: '1:1', count: 1 } });
    expect(
      validateGenerationRequest({
        tool: 'text-to-image',
        modelId: 'aivore-demo-image',
        prompt: 'p',
        params: { count: 4 },
      }),
    ).toMatchObject({ ok: true, cost: 4 });
    expect(
      validateGenerationRequest({
        tool: 'text-to-video',
        modelId: 'aivore-demo-video',
        prompt: 'p',
      }),
    ).toMatchObject({ ok: true, cost: 6, params: { durationSec: 3, resolution: '480p' } });
    expect(
      validateGenerationRequest({
        tool: 'text-to-video',
        modelId: 'aivore-demo-video',
        prompt: 'p',
        params: { durationSec: 5, resolution: '720p' },
      }),
    ).toMatchObject({ ok: true, cost: 15 });
  });

  it('rejects what the Demo video model does not offer', () => {
    const result = validateGenerationRequest({
      tool: 'text-to-video',
      modelId: 'aivore-demo-video',
      prompt: 'p',
      negativePrompt: 'blurry',
      params: { durationSec: 4, resolution: '1080p', strength: 0.5 },
    });
    expect(issuesOf(result)).toEqual([
      { path: 'negativePrompt', code: 'unsupported' },
      { path: 'params.durationSec', code: 'not_allowed' },
      { path: 'params.resolution', code: 'not_allowed' },
      { path: 'params.strength', code: 'unsupported' },
    ]);
  });
});

describe('wrongly typed fields', () => {
  const base = { tool: 'text-to-image', modelId: fullImageModel.id, prompt: 'p' } as const;
  const cases: Array<[string, Record<string, unknown>, string, GenerationValidationCode]> = [
    ['params as an array', { params: [] }, 'params', 'invalid_type'],
    ['params as a string', { params: 'x' }, 'params', 'invalid_type'],
    ['params as null', { params: null }, 'params', 'invalid_type'],
    ['prompt as a number', { prompt: 5 }, 'prompt', 'invalid_type'],
    ['negativePrompt as a number', { negativePrompt: 5 }, 'negativePrompt', 'invalid_type'],
    [
      'inputAssetId as a number',
      { tool: 'image-to-image', inputAssetId: 5 },
      'inputAssetId',
      'invalid_type',
    ],
    ['isPublic as a string', { isPublic: 'yes' }, 'isPublic', 'invalid_type'],
    ['count as a string', { params: { count: '2' } }, 'params.count', 'invalid_type'],
    ['seed as a string', { params: { seed: '7' } }, 'params.seed', 'invalid_type'],
    [
      'strength as a string',
      { tool: 'image-to-image', inputAssetId: 'a', params: { strength: '1' } },
      'params.strength',
      'invalid_type',
    ],
  ];
  it.each(cases)('reports %s', (_label, patch, path, code) => {
    const result = validateForModel(
      { ...base, ...patch } as unknown as CreateGenerationRequest,
      fullImageModel,
    );
    expect(issuesOf(result)).toContainEqual({ path, code });
  });

  it('treats an unnamed isPublic as fine and keeps a boolean one out of the way', () => {
    for (const isPublic of [undefined, true, false]) {
      expect(validateForModel({ ...base, isPublic }, fullImageModel).ok).toBe(true);
    }
  });
});

describe('defaultParamsFor', () => {
  it('matches what a bare request is normalized to', () => {
    for (const model of fixtureModels) {
      const tool = model.tools[0] as Tool;
      const result = validateForModel(baseRequest(model, tool), model);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      expect(result.params).toEqual(defaultParamsFor(model));
    }
  });
});

// ---- Property-style sweeps over the whole catalog ------------------------------------------

interface Allowed {
  label: string;
  request: CreateGenerationRequest;
  expected: GenerationParams;
}

function* allowedRequests(model: ModelSpec, tool: Tool): Generator<Allowed> {
  const { limits } = model;
  const base = baseRequest(model, tool);
  const counts = Array.from({ length: limits.maxCount }, (_, index) => index + 1);
  const durations: Array<number | undefined> = limits.durations ?? [undefined];
  const resolutions = limits.resolutions ?? [undefined];

  yield { label: 'defaults', request: base, expected: defaultParamsFor(model) };

  // A model whose result keeps the input's proportions accepts a ratio and ignores it.
  const ignoresAspect = limits.followsInputAspect === true && needsImage(tool);
  for (const aspectRatio of ignoresAspect ? ASPECT_RATIOS : limits.aspectRatios) {
    for (const count of counts) {
      for (const durationSec of durations) {
        for (const resolution of resolutions) {
          const params = {
            aspectRatio,
            count,
            ...(durationSec === undefined ? {} : { durationSec }),
            ...(resolution === undefined ? {} : { resolution }),
          };
          yield {
            label: JSON.stringify(params),
            request: { ...base, params },
            expected: ignoresAspect
              ? { ...params, aspectRatio: limits.defaultAspectRatio }
              : params,
          };
        }
      }
    }
  }

  if (limits.supportsSeed) {
    for (const seed of [0, 1, 123_456, 4_294_967_295]) {
      yield {
        label: `seed ${seed}`,
        request: { ...base, params: { seed } },
        expected: { ...defaultParamsFor(model), seed },
      };
    }
  }
  if (limits.supportsStrength && needsImage(tool)) {
    for (const strength of [0, 0.25, 0.5, 1]) {
      yield {
        label: `strength ${strength}`,
        request: { ...base, params: { strength } },
        expected: { ...defaultParamsFor(model), strength },
      };
    }
  }
}

describe('every model x tool x allowed parameter combination', () => {
  const models = modelsUnderTest();

  it('covers the fixtures at least', () => {
    expect(models.length).toBeGreaterThanOrEqual(fixtureModels.length);
  });

  describe.each(models.map((model) => [model.id, model] as const))('%s', (_id, model) => {
    for (const tool of TOOLS) {
      if (!model.tools.includes(tool)) continue;

      it(`${tool}: every allowed combination validates and is priced`, () => {
        let checked = 0;
        for (const { label, request, expected } of allowedRequests(model, tool)) {
          const result = run(model, request);
          if (!result.ok) {
            throw new Error(`${model.id} ${tool} ${label}: ${JSON.stringify(result.errors)}`);
          }
          expect(result.model).toBe(model);
          expect(result.params, label).toEqual(expected);
          expect(result.cost, label).toBe(computeCost(model, result.params));
          expect(Number.isInteger(result.cost) && result.cost >= 1, label).toBe(true);
          checked += 1;
        }
        expect(checked).toBeGreaterThan(0);
      });

      it(`${tool}: a negative prompt is accepted exactly when the model supports it`, () => {
        const result = run(model, { ...baseRequest(model, tool), negativePrompt: 'blurry' });
        if (model.limits.supportsNegativePrompt) {
          expect(result).toMatchObject({ ok: true, negativePrompt: 'blurry' });
        } else {
          expect(issuesOf(result)).toEqual([{ path: 'negativePrompt', code: 'unsupported' }]);
        }
      });

      it(`${tool}: every disallowed value fails with a precise per-field error`, () => {
        const { limits } = model;
        const base = baseRequest(model, tool);
        const cases: Array<[string, CreateGenerationRequest, string, GenerationValidationCode]> =
          [];
        const add = (
          label: string,
          patch: Partial<CreateGenerationRequest>,
          path: string,
          code: GenerationValidationCode,
        ) => cases.push([label, { ...base, ...patch }, path, code]);
        const withParams = (params: Record<string, unknown>) =>
          ({ params }) as Partial<CreateGenerationRequest>;

        const ignoresAspect = limits.followsInputAspect === true && needsImage(tool);
        for (const ratio of ASPECT_RATIOS) {
          if (!limits.aspectRatios.includes(ratio) && !ignoresAspect) {
            add(
              `aspect ${ratio}`,
              withParams({ aspectRatio: ratio }),
              'params.aspectRatio',
              'not_allowed',
            );
          }
        }
        add('aspect junk', withParams({ aspectRatio: '5:4' }), 'params.aspectRatio', 'not_allowed');
        add('aspect type', withParams({ aspectRatio: 1 }), 'params.aspectRatio', 'not_allowed');

        for (const count of [0, -1, limits.maxCount + 1, 1.5, Number.NaN]) {
          add(`count ${count}`, withParams({ count }), 'params.count', 'out_of_range');
        }
        add('count string', withParams({ count: '1' }), 'params.count', 'invalid_type');

        if (limits.durations?.length) {
          const durations = limits.durations;
          for (const durationSec of [
            0,
            -1,
            Math.max(...durations) + 1,
            Math.min(...durations) + 0.5,
          ]) {
            if (durations.includes(durationSec)) continue;
            add(
              `duration ${durationSec}`,
              withParams({ durationSec }),
              'params.durationSec',
              'not_allowed',
            );
          }
        } else {
          add('duration', withParams({ durationSec: 5 }), 'params.durationSec', 'unsupported');
        }

        if (limits.resolutions?.length) {
          for (const resolution of [...RESOLUTIONS, '4k']) {
            if ((limits.resolutions as string[]).includes(resolution)) continue;
            add(
              `resolution ${resolution}`,
              withParams({ resolution }),
              'params.resolution',
              'not_allowed',
            );
          }
        } else {
          add('resolution', withParams({ resolution: '720p' }), 'params.resolution', 'unsupported');
        }

        if (limits.supportsSeed) {
          for (const seed of [-1, 4_294_967_296, 1.5]) {
            add(`seed ${seed}`, withParams({ seed }), 'params.seed', 'out_of_range');
          }
        } else {
          add('seed', withParams({ seed: 7 }), 'params.seed', 'unsupported');
        }

        if (limits.supportsStrength && needsImage(tool)) {
          for (const strength of [-0.01, 1.01, 2]) {
            add(
              `strength ${strength}`,
              withParams({ strength }),
              'params.strength',
              'out_of_range',
            );
          }
        } else {
          add('strength', withParams({ strength: 0.5 }), 'params.strength', 'unsupported');
        }

        if (limits.supportsNegativePrompt) {
          add(
            'negative too long',
            { negativePrompt: 'x'.repeat(limits.maxPromptChars + 1) },
            'negativePrompt',
            'too_long',
          );
        } else {
          add('negative', { negativePrompt: 'blurry' }, 'negativePrompt', 'unsupported');
        }

        add('prompt empty', { prompt: '' }, 'prompt', 'required');
        add(
          'prompt too long',
          { prompt: 'x'.repeat(limits.maxPromptChars + 1) },
          'prompt',
          'too_long',
        );

        if (needsImage(tool)) {
          const { inputAssetId: _omitted, ...withoutImage } = base;
          cases.push(['image missing', withoutImage, 'inputAssetId', 'required']);
        } else {
          add('image given', { inputAssetId: newId('ast') }, 'inputAssetId', 'unsupported');
        }

        for (const [label, request, path, code] of cases) {
          const result = run(model, request);
          expect(issuesOf(result), `${model.id} ${tool} ${label}`).toEqual([{ path, code }]);
        }
      });
    }

    for (const tool of TOOLS) {
      if (model.tools.includes(tool)) continue;
      it(`${tool}: is rejected as a tool/model mismatch`, () => {
        const result = run(model, baseRequest(model, tool));
        expect(issuesOf(result)).toContainEqual({ path: 'modelId', code: 'model_tool_mismatch' });
      });
    }
  });
});
