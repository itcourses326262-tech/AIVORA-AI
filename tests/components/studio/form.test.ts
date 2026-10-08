import { describe, expect, it } from 'vitest';
import type { GenerationDTO, ModelDTO } from '@/lib/api-types';
import { computeCost, getModels } from '@/lib/catalog';
import { TOOLS, type Tool } from '@/lib/catalog/types';
import { newId } from '@/lib/id';
import { toolNeedsImage } from '@/lib/tools';
import { validateForModel } from '@/lib/validation/generation';
import {
  buildParams,
  buildRequest,
  costOf,
  createStudioForm,
  formProblems,
  initialStudioState,
  isDemoModel,
  modelsForTool,
  parseSeed,
  pickModel,
  reconcile,
  settingsOf,
  showsAspect,
  studioReducer,
  toAsciiDigits,
  toModelSpec,
  type StudioForm,
  type StudioState,
} from '@/components/studio/form';
import {
  DEMO_IMAGE,
  DEMO_VIDEO,
  EDIT_MODEL,
  FLUX_UNAVAILABLE,
  generationDTO,
  modelDTO,
} from '../generations/support';

const catalog = (): ModelDTO[] => getModels().map((model) => modelDTO(model.id));

function stateWith(models: ModelDTO[], tool: Tool = 'text-to-image'): StudioState {
  return studioReducer(initialStudioState(tool, {}, null), { type: 'models', models });
}

describe('pickModel', () => {
  it('prefers the chosen model while it serves the tool and is configured', () => {
    const models = [DEMO_IMAGE(), modelDTO('fal-flux-schnell')];
    expect(pickModel(models, 'text-to-image', 'aivore-demo-image')?.id).toBe('aivore-demo-image');
  });

  it('prefers a real model over a Demo one when nothing is chosen', () => {
    const models = [DEMO_IMAGE(), modelDTO('fal-flux-schnell')];
    expect(pickModel(models, 'text-to-image', null)?.id).toBe('fal-flux-schnell');
  });

  it('never picks a model whose provider is not configured, or one for another tool', () => {
    const models = [FLUX_UNAVAILABLE(), DEMO_IMAGE(), DEMO_VIDEO()];
    expect(pickModel(models, 'text-to-image', 'fal-flux-schnell')?.id).toBe('aivore-demo-image');
    expect(pickModel(models, 'text-to-video', 'aivore-demo-image')?.id).toBe('aivore-demo-video');
    expect(pickModel([FLUX_UNAVAILABLE()], 'text-to-image', null)).toBeUndefined();
    expect(pickModel([], 'text-to-image', null)).toBeUndefined();
  });

  it('knows which models are Demo ones and which serve a tool', () => {
    expect(isDemoModel(DEMO_IMAGE())).toBe(true);
    expect(isDemoModel(FLUX_UNAVAILABLE())).toBe(false);
    expect(
      modelsForTool(catalog(), 'image-to-video').every((m) => m.tools.includes('image-to-video')),
    ).toBe(true);
  });
});

describe('reconcile', () => {
  it('fills the model-dependent fields with the model defaults', () => {
    const form = reconcile(createStudioForm('text-to-video'), DEMO_VIDEO());
    expect(form).toMatchObject({
      modelId: 'aivore-demo-video',
      aspectRatio: '16:9',
      count: 1,
      durationSec: 3,
      resolution: '480p',
    });
  });

  it('puts values the new model does not allow back to its defaults', () => {
    const wide = { ...createStudioForm('text-to-image'), aspectRatio: '21:9' as const, count: 4 };
    const flux2 = modelDTO('fal-flux-2-pro');
    const next = reconcile(wide, flux2);
    // FLUX.2 Pro makes one image at a time.
    expect(next.count).toBe(1);
    expect(next.aspectRatio).toBe('21:9');
    const demo = reconcile(wide, DEMO_IMAGE());
    expect(demo.aspectRatio).toBe('1:1');
    expect(demo.count).toBe(4);
  });

  it('forgets duration and resolution for a model without them', () => {
    const form = {
      ...createStudioForm('text-to-video'),
      durationSec: 5,
      resolution: '720p' as const,
    };
    const next = reconcile(form, DEMO_IMAGE());
    expect(next.durationSec).toBeNull();
    expect(next.resolution).toBeNull();
  });

  it('is a no-op without a model', () => {
    const form = createStudioForm('text-to-image');
    expect(reconcile(form, undefined)).toBe(form);
  });
});

describe('studioReducer', () => {
  it('picks a model for the tool as soon as the models arrive', () => {
    const state = stateWith([DEMO_IMAGE(), DEMO_VIDEO(), FLUX_UNAVAILABLE()]);
    expect(state.form.modelId).toBe('aivore-demo-image');
    expect(state.form.aspectRatio).toBe('1:1');
  });

  it('remembers the settings of each tool and restores them when the tab is selected again', () => {
    let state = stateWith([DEMO_IMAGE(), DEMO_VIDEO()]);
    state = studioReducer(state, {
      type: 'patch',
      patch: { aspectRatio: '16:9', count: 3, prompt: 'a cat' },
    });
    state = studioReducer(state, { type: 'tool', tool: 'text-to-video' });
    expect(state.form.modelId).toBe('aivore-demo-video');
    state = studioReducer(state, { type: 'patch', patch: { durationSec: 5, resolution: '720p' } });
    state = studioReducer(state, { type: 'tool', tool: 'text-to-image' });
    expect(state.form).toMatchObject({ tool: 'text-to-image', aspectRatio: '16:9', count: 3 });
    state = studioReducer(state, { type: 'tool', tool: 'text-to-video' });
    expect(state.form).toMatchObject({ durationSec: 5, resolution: '720p' });
  });

  it('keeps what is about the request, not the tool, across tools: prompt, negative prompt, seed, sharing', () => {
    let state = stateWith([DEMO_IMAGE(), DEMO_VIDEO()]);
    state = studioReducer(state, {
      type: 'patch',
      patch: { prompt: 'a cat', negativePrompt: 'blur', seed: '42', isPublic: true },
    });
    state = studioReducer(state, { type: 'tool', tool: 'image-to-image' });
    expect(state.form).toMatchObject({
      prompt: 'a cat',
      negativePrompt: 'blur',
      seed: '42',
      isPublic: true,
    });
  });

  it('ignores a switch to the tool it is already on', () => {
    const state = stateWith([DEMO_IMAGE()]);
    expect(studioReducer(state, { type: 'tool', tool: 'text-to-image' })).toBe(state);
  });

  it('changes the model and reshapes the fields; refuses a model that is unavailable or serves another tool', () => {
    let state = stateWith([
      DEMO_IMAGE(),
      modelDTO('fal-flux-2-pro'),
      FLUX_UNAVAILABLE(),
      DEMO_VIDEO(),
    ]);
    state = studioReducer(state, { type: 'patch', patch: { count: 4 } });
    const switched = studioReducer(state, { type: 'model', modelId: 'fal-flux-2-pro' });
    expect(switched.form).toMatchObject({ modelId: 'fal-flux-2-pro', count: 1 });
    expect(studioReducer(state, { type: 'model', modelId: 'fal-flux-schnell' })).toBe(state);
    expect(studioReducer(state, { type: 'model', modelId: 'aivore-demo-video' })).toBe(state);
    expect(studioReducer(state, { type: 'model', modelId: 'nope' })).toBe(state);
  });

  it('repairs a remembered model that is gone when the models arrive', () => {
    const state = studioReducer(initialStudioState('text-to-image', {}, 'removed-model'), {
      type: 'models',
      models: [DEMO_IMAGE()],
    });
    expect(state.form.modelId).toBe('aivore-demo-image');
  });

  it('applies a prefill: tool, model and prompt', () => {
    let state = stateWith([DEMO_IMAGE(), DEMO_VIDEO(), modelDTO('fal-flux-2-pro')]);
    state = studioReducer(state, {
      type: 'prefill',
      tool: 'text-to-video',
      modelId: 'aivore-demo-video',
      prompt: 'waves',
    });
    expect(state.form).toMatchObject({
      tool: 'text-to-video',
      modelId: 'aivore-demo-video',
      prompt: 'waves',
    });
    // A model that does not serve the (new) tool is not applied.
    state = studioReducer(state, { type: 'prefill', modelId: 'fal-flux-2-pro' });
    expect(state.form.modelId).toBe('aivore-demo-video');
  });

  describe('reuse', () => {
    const run = (overrides: Partial<GenerationDTO>) =>
      generationDTO({
        tool: 'image-to-image',
        prompt: 'Turn it into watercolor',
        negativePrompt: 'blur',
        params: { aspectRatio: '4:3', count: 2, seed: 99, strength: 0.3 },
        ...overrides,
      });

    it('puts the settings of a generation back into the form', () => {
      const state = studioReducer(stateWith([DEMO_IMAGE(), DEMO_VIDEO()]), {
        type: 'reuse',
        generation: run({}),
      });
      expect(state.form).toMatchObject({
        tool: 'image-to-image',
        modelId: 'aivore-demo-image',
        prompt: 'Turn it into watercolor',
        negativePrompt: 'blur',
        aspectRatio: '4:3',
        count: 2,
        seed: '99',
        strength: 0.3,
        isPublic: false,
      });
    });

    it('restores a video generation, duration and resolution included', () => {
      const state = studioReducer(stateWith([DEMO_IMAGE(), DEMO_VIDEO()]), {
        type: 'reuse',
        generation: run({
          tool: 'text-to-video',
          kind: 'video',
          modelId: 'aivore-demo-video',
          params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '720p' },
        }),
      });
      expect(state.form).toMatchObject({
        tool: 'text-to-video',
        durationSec: 5,
        resolution: '720p',
      });
    });

    it('falls back to a model that exists when the original is gone, keeping the rest', () => {
      const state = studioReducer(stateWith([DEMO_IMAGE()]), {
        type: 'reuse',
        generation: run({ modelId: 'removed-model' }),
      });
      expect(state.form.modelId).toBe('aivore-demo-image');
      expect(state.form.prompt).toBe('Turn it into watercolor');
    });
  });
});

describe('cost and request parity with the server', () => {
  const inputAssetId = newId('ast');

  it('prices every model, tool and option the way the server does, and builds a request the server accepts', () => {
    let checked = 0;
    for (const spec of getModels()) {
      const model = modelDTO(spec.id);
      for (const tool of spec.tools) {
        const { limits } = model;
        const counts = Array.from({ length: limits.maxCount }, (_, i) => i + 1);
        for (const aspectRatio of limits.aspectRatios) {
          for (const count of counts) {
            for (const durationSec of limits.durations ?? [null]) {
              for (const resolution of limits.resolutions ?? [null]) {
                const form: StudioForm = {
                  ...reconcile(createStudioForm(tool), model),
                  aspectRatio,
                  count,
                  durationSec,
                  resolution,
                  prompt: 'A lone lighthouse',
                  negativePrompt: 'blur',
                  seed: '12345',
                  strength: 0.4,
                };
                const request = buildRequest(
                  form,
                  model,
                  toolNeedsImage(tool) ? inputAssetId : undefined,
                );
                const verdict = validateForModel(request, spec);
                expect(verdict.ok, `${spec.id} ${tool}: ${JSON.stringify(verdict)}`).toBe(true);
                if (verdict.ok) {
                  expect(costOf(form, model)).toBe(verdict.cost);
                  expect(costOf(form, model)).toBe(computeCost(spec, buildParams(form, model)));
                }
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('turns a ModelDTO into a ModelSpec that prices the same', () => {
    const dto = DEMO_VIDEO();
    expect(
      costOf(
        {
          ...reconcile(createStudioForm('text-to-video'), dto),
          durationSec: 5,
          resolution: '720p',
        },
        dto,
      ),
    ).toBe(15);
    expect(toModelSpec(dto).pricing).toEqual(dto.pricing);
  });

  it('has no cost without a model', () => {
    expect(costOf(createStudioForm('text-to-image'), undefined)).toBeNull();
  });

  it('has no cost for a combination that cannot be priced, instead of throwing', () => {
    const broken: ModelDTO = { ...DEMO_VIDEO(), pricing: { type: 'video', perSecond: {} } };
    expect(costOf(reconcile(createStudioForm('text-to-video'), broken), broken)).toBeNull();
  });
});

describe('buildRequest', () => {
  const base = (tool: Tool, model: ModelDTO) => ({
    ...reconcile(createStudioForm(tool), model),
    prompt: '  A lone lighthouse  ',
  });

  it('sends only what the model supports', () => {
    const flux = modelDTO('fal-flux-schnell');
    const request = buildRequest(
      { ...base('text-to-image', flux), negativePrompt: 'blur', seed: '5', strength: 0.9 },
      flux,
      undefined,
    );
    expect(request).toEqual({
      tool: 'text-to-image',
      modelId: 'fal-flux-schnell',
      prompt: 'A lone lighthouse',
      params: { aspectRatio: '1:1', count: 1, seed: 5 },
      isPublic: false,
    });
  });

  it('sends the negative prompt, seed and strength where they exist', () => {
    const demo = DEMO_IMAGE();
    const request = buildRequest(
      { ...base('image-to-image', demo), negativePrompt: ' blur ', seed: ' 7 ', strength: 0.25 },
      demo,
      'ast_input',
    );
    expect(request).toMatchObject({
      negativePrompt: 'blur',
      params: { seed: 7, strength: 0.25 },
      inputAssetId: 'ast_input',
    });
  });

  it('leaves strength out of a text tool and the input out of a request that has none', () => {
    const demo = DEMO_IMAGE();
    const request = buildRequest(
      { ...base('text-to-image', demo), strength: 0.25 },
      demo,
      'ast_stray',
    );
    expect(request.params).not.toHaveProperty('strength');
    expect(request).not.toHaveProperty('inputAssetId');
  });

  it('leaves an empty negative prompt and an empty seed out', () => {
    const demo = DEMO_IMAGE();
    const request = buildRequest(
      { ...base('text-to-image', demo), negativePrompt: '  ', seed: '' },
      demo,
      undefined,
    );
    expect(request).not.toHaveProperty('negativePrompt');
    expect(request.params).not.toHaveProperty('seed');
  });

  it('shares only when asked', () => {
    const demo = DEMO_IMAGE();
    expect(buildRequest(base('text-to-image', demo), demo, undefined).isPublic).toBe(false);
    expect(
      buildRequest({ ...base('text-to-image', demo), isPublic: true }, demo, undefined).isPublic,
    ).toBe(true);
  });

  it('does not send an aspect ratio for a model that keeps the shape of the input image', () => {
    const edit = EDIT_MODEL();
    expect(showsAspect(edit, 'image-to-image')).toBe(false);
    expect(showsAspect(edit, 'text-to-image')).toBe(true);
    expect(showsAspect(DEMO_IMAGE(), 'image-to-image')).toBe(true);
    const request = buildRequest(base('image-to-image', edit), edit, 'ast_input');
    expect(request.params).not.toHaveProperty('aspectRatio');
    expect(request.params).toMatchObject({ count: 1 });
  });

  it('sends the duration and resolution of a video', () => {
    const video = DEMO_VIDEO();
    const request = buildRequest(
      { ...base('text-to-video', video), durationSec: 5, resolution: '720p' },
      video,
      undefined,
    );
    expect(request.params).toEqual({
      aspectRatio: '16:9',
      count: 1,
      durationSec: 5,
      resolution: '720p',
    });
  });
});

describe('formProblems', () => {
  const ready = (overrides: Partial<StudioForm> = {}): StudioForm => ({
    ...reconcile(createStudioForm('text-to-image'), DEMO_IMAGE()),
    prompt: 'a cat',
    ...overrides,
  });

  it('has none for a form that can be sent', () => {
    expect(formProblems(ready(), DEMO_IMAGE(), 'none')).toEqual([]);
  });

  it('wants a model first', () => {
    expect(formProblems(ready(), undefined, 'none')).toEqual([
      { field: 'modelId', code: 'required' },
    ]);
  });

  it('wants a prompt that is not blank and not longer than the model takes', () => {
    expect(formProblems(ready({ prompt: '   ' }), DEMO_IMAGE(), 'none')).toEqual([
      { field: 'prompt', code: 'required' },
    ]);
    const long = formProblems(ready({ prompt: 'x'.repeat(2001) }), DEMO_IMAGE(), 'none');
    expect(long).toEqual([{ field: 'prompt', code: 'too_long', max: 2000 }]);
    expect(formProblems(ready({ prompt: 'x'.repeat(2000) }), DEMO_IMAGE(), 'none')).toEqual([]);
  });

  it('counts the prompt the way the server does: an emoji is one character', () => {
    expect(formProblems(ready({ prompt: '😀'.repeat(2000) }), DEMO_IMAGE(), 'none')).toEqual([]);
  });

  it('wants an input image for image tools, and waits for an upload in progress', () => {
    const form = ready({ tool: 'image-to-image' });
    expect(formProblems(form, DEMO_IMAGE(), 'none')).toEqual([
      { field: 'inputAssetId', code: 'required' },
    ]);
    expect(formProblems(form, DEMO_IMAGE(), 'busy')).toEqual([
      { field: 'inputAssetId', code: 'uploading' },
    ]);
    expect(formProblems(form, DEMO_IMAGE(), 'ready')).toEqual([]);
    expect(formProblems(ready(), DEMO_IMAGE(), 'none')).toEqual([]);
  });

  it('rejects a seed that is not a number from 0 to 4294967295, but only where seeds exist', () => {
    expect(formProblems(ready({ seed: '4294967296' }), DEMO_IMAGE(), 'none')).toEqual([
      { field: 'seed', code: 'invalid' },
    ]);
    expect(formProblems(ready({ seed: '4294967295' }), DEMO_IMAGE(), 'none')).toEqual([]);
    const noSeed: ModelDTO = {
      ...DEMO_IMAGE(),
      limits: { ...DEMO_IMAGE().limits, supportsSeed: false },
    };
    expect(formProblems(ready({ seed: 'abc' }), noSeed, 'none')).toEqual([]);
  });

  it('lists every problem in the order of the fields', () => {
    expect(
      formProblems(
        ready({ tool: 'image-to-image', prompt: '', seed: 'x' }),
        DEMO_IMAGE(),
        'none',
      ).map((p) => p.field),
    ).toEqual(['prompt', 'inputAssetId', 'seed']);
  });
});

describe('seed helpers', () => {
  it('parses a seed: empty is "random", garbage is invalid', () => {
    expect(parseSeed('')).toBeUndefined();
    expect(parseSeed('  ')).toBeUndefined();
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed(' 42 ')).toBe(42);
    expect(parseSeed('4294967295')).toBe(4294967295);
    expect(parseSeed('4294967296')).toBeNull();
    expect(parseSeed('12345678901')).toBeNull();
    expect(parseSeed('-1')).toBeNull();
    expect(parseSeed('1.5')).toBeNull();
    expect(parseSeed('abc')).toBeNull();
  });

  it('turns the digits of an Arabic keyboard into 0-9 and drops everything else', () => {
    expect(toAsciiDigits('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
    expect(toAsciiDigits('4a2 b')).toBe('42');
    expect(toAsciiDigits('')).toBe('');
  });
});

describe('settingsOf and initialStudioState', () => {
  it('keeps only what is remembered between visits', () => {
    const form = {
      ...reconcile(createStudioForm('text-to-image'), DEMO_IMAGE()),
      prompt: 'secret',
      seed: '1',
      isPublic: true,
    };
    expect(Object.keys(settingsOf(form)).sort()).toEqual(
      ['aspectRatio', 'count', 'durationSec', 'modelId', 'resolution', 'strength'].sort(),
    );
  });

  it('starts from the remembered settings of the tool, with the model of the link first', () => {
    const state = initialStudioState(
      'text-to-image',
      {
        'text-to-image': {
          modelId: 'a',
          aspectRatio: '9:16',
          count: 2,
          durationSec: null,
          resolution: null,
          strength: null,
        },
      },
      'b',
    );
    expect(state.form).toMatchObject({
      modelId: 'b',
      aspectRatio: '9:16',
      count: 2,
      prompt: '',
      isPublic: false,
    });
  });

  it('covers every tool', () => {
    for (const tool of TOOLS) expect(createStudioForm(tool).tool).toBe(tool);
  });
});
