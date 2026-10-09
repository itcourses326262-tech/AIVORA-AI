/**
 * The studio form as a pure state machine: what the controls hold, how a change of tool or model
 * reshapes the other fields (an aspect ratio the new model lacks falls back to its default), what
 * request the form turns into, and what is still missing before it can be sent. No React, no I/O:
 * the studio hooks and the tests both drive it.
 */
import type { CreateGenerationRequest, GenerationDTO, ModelDTO } from '@/lib/api-types';
import { computeCost } from '@/lib/catalog';
import type {
  AspectRatio,
  GenerationParams,
  ModelSpec,
  Resolution,
  Tool,
} from '@/lib/catalog/types';
import { charCount } from '@/lib/generations/format';
import { toolNeedsImage } from '@/lib/tools';

export const DEFAULT_TOOL: Tool = 'text-to-image';
export const MAX_SEED = 4_294_967_295;
export const DEFAULT_STRENGTH = 0.6;

/** What is remembered per tool between visits (never the prompt, the seed or the share switch). */
export interface ToolSettings {
  modelId: string | null;
  aspectRatio: AspectRatio | null;
  count: number | null;
  durationSec: number | null;
  resolution: Resolution | null;
  strength: number | null;
}

export interface StudioForm extends ToolSettings {
  tool: Tool;
  prompt: string;
  negativePrompt: string;
  /** Digits as typed; empty means "random". */
  seed: string;
  /** Share the result to Explore. Off for every new generation. */
  isPublic: boolean;
}

export interface StudioState {
  form: StudioForm;
  /** The settings of the other tools, restored when their tab is selected again. */
  saved: Partial<Record<Tool, ToolSettings>>;
  models: readonly ModelDTO[];
  /**
   * Tools for which the user clicked the Demo model in the picker. Only that beats a real model: a
   * Demo choice that was merely remembered (it was the only model when it was saved) or came from
   * the address bar must not keep the studio on fake pictures once a real model is configured.
   */
  demoChosen: Partial<Record<Tool, true>>;
}

export type StudioAction =
  | { type: 'models'; models: readonly ModelDTO[] }
  | { type: 'tool'; tool: Tool }
  | {
      type: 'model';
      modelId: string;
      /** Set by the picker: a Demo model then wins over real ones. */ explicit?: boolean;
    }
  | { type: 'patch'; patch: Partial<Omit<StudioForm, 'tool'>> }
  | { type: 'reuse'; generation: GenerationDTO }
  | { type: 'prefill'; tool?: Tool; modelId?: string; prompt?: string };

// ---- Models --------------------------------------------------------------------------------------

export function modelsForTool(models: readonly ModelDTO[], tool: Tool): ModelDTO[] {
  return models.filter((model) => model.tools.includes(tool));
}

export function isDemoModel(model: Pick<ModelDTO, 'badges'>): boolean {
  return model.badges?.includes('demo') ?? false;
}

/**
 * The model to use: the preferred one while it serves the tool and its provider is configured,
 * otherwise the first configured one (real models before the Demo ones). A preferred Demo model is
 * ignored while a real one is configured, unless `allowDemo` says the user chose it on purpose.
 */
export function pickModel(
  models: readonly ModelDTO[],
  tool: Tool,
  preferredId: string | null,
  allowDemo = false,
): ModelDTO | undefined {
  const usable = modelsForTool(models, tool).filter((model) => model.available);
  const real = usable.find((model) => !isDemoModel(model));
  const preferred = usable.find((model) => model.id === preferredId);
  // A preferred Demo model only counts when the user picked it on purpose or nothing real exists.
  if (preferred && (allowDemo || !isDemoModel(preferred) || !real)) return preferred;
  return real ?? usable[0];
}

/** `computeCost` takes a catalog `ModelSpec`; a `ModelDTO` is one without the upstream id. */
export function toModelSpec(model: ModelDTO): ModelSpec {
  return { ...model, providerModel: model.id };
}

// ---- Fields that depend on the model -------------------------------------------------------------

/** Whether the aspect-ratio control exists: not for models that keep the input image's shape. */
export function showsAspect(model: ModelDTO, tool: Tool): boolean {
  return !(model.limits.followsInputAspect === true && toolNeedsImage(tool));
}

function oneOf<T>(
  value: T | null,
  allowed: readonly T[] | undefined,
  fallback: T | null,
): T | null {
  if (value !== null && allowed?.includes(value)) return value;
  return allowed && allowed.length > 0 ? fallback : null;
}

/** Puts every model-dependent field back inside what `model` allows. */
export function reconcile(form: StudioForm, model: ModelDTO | undefined): StudioForm {
  if (!model) return form;
  const { limits } = model;
  return {
    ...form,
    modelId: model.id,
    aspectRatio: oneOf(form.aspectRatio, limits.aspectRatios, limits.defaultAspectRatio),
    count: Math.min(Math.max(form.count ?? limits.defaultCount, 1), limits.maxCount),
    durationSec: oneOf(
      form.durationSec,
      limits.durations,
      limits.defaultDuration ?? limits.durations?.[0] ?? null,
    ),
    resolution: oneOf(
      form.resolution,
      limits.resolutions,
      limits.defaultResolution ?? limits.resolutions?.[0] ?? null,
    ),
    strength: form.strength ?? DEFAULT_STRENGTH,
  };
}

export function settingsOf(form: StudioForm): ToolSettings {
  return {
    modelId: form.modelId,
    aspectRatio: form.aspectRatio,
    count: form.count,
    durationSec: form.durationSec,
    resolution: form.resolution,
    strength: form.strength,
  };
}

const EMPTY_SETTINGS: ToolSettings = {
  modelId: null,
  aspectRatio: null,
  count: null,
  durationSec: null,
  resolution: null,
  strength: null,
};

export function createStudioForm(tool: Tool, settings: Partial<ToolSettings> = {}): StudioForm {
  return {
    ...EMPTY_SETTINGS,
    ...settings,
    tool,
    prompt: '',
    negativePrompt: '',
    seed: '',
    isPublic: false,
  };
}

export function initialStudioState(
  tool: Tool,
  saved: Partial<Record<Tool, ToolSettings>>,
  modelId: string | null,
): StudioState {
  return {
    form: createStudioForm(tool, { ...saved[tool], ...(modelId ? { modelId } : {}) }),
    saved,
    models: [],
    demoChosen: {},
  };
}

function withModel(state: StudioState, form: StudioForm): StudioState {
  const model = pickModel(
    state.models,
    form.tool,
    form.modelId,
    state.demoChosen[form.tool] === true,
  );
  return { ...state, form: model ? reconcile(form, model) : form };
}

/** Rebuilds the form from a generation: the settings it ran with, as far as its model allows. */
function formFromGeneration(generation: GenerationDTO, models: readonly ModelDTO[]): StudioForm {
  const { params } = generation;
  const base = createStudioForm(generation.tool, {
    modelId: generation.modelId,
    aspectRatio: params.aspectRatio,
    count: params.count,
    durationSec: params.durationSec ?? null,
    resolution: params.resolution ?? null,
    strength: params.strength ?? null,
  });
  const form: StudioForm = {
    ...base,
    prompt: generation.prompt,
    negativePrompt: generation.negativePrompt ?? '',
    seed: params.seed === undefined ? '' : String(params.seed),
  };
  // Reusing a creation's settings is deliberate, so a Demo model it used is honoured.
  const model = pickModel(models, generation.tool, generation.modelId, true);
  return model ? reconcile(form, model) : form;
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'models':
      return withModel({ ...state, models: action.models }, state.form);
    case 'tool': {
      if (action.tool === state.form.tool) return state;
      const saved = { ...state.saved, [state.form.tool]: settingsOf(state.form) };
      const next: StudioForm = {
        ...state.form,
        ...EMPTY_SETTINGS,
        ...saved[action.tool],
        tool: action.tool,
      };
      return withModel({ ...state, saved }, next);
    }
    case 'model': {
      const model = state.models.find((candidate) => candidate.id === action.modelId);
      if (!model || !model.available || !model.tools.includes(state.form.tool)) return state;
      const tool = state.form.tool;
      const demo = isDemoModel(model);
      const realConfigured = modelsForTool(state.models, tool).some(
        (candidate) => candidate.available && !isDemoModel(candidate),
      );
      // The address bar and stored settings never put a Demo model over a configured real one.
      if (demo && !action.explicit && realConfigured) return state;
      const demoChosen = { ...state.demoChosen };
      if (action.explicit) {
        if (demo) demoChosen[tool] = true;
        else delete demoChosen[tool];
      }
      return {
        ...state,
        demoChosen,
        form: reconcile({ ...state.form, modelId: model.id }, model),
      };
    }
    case 'patch':
      return { ...state, form: { ...state.form, ...action.patch } };
    case 'reuse': {
      const saved = { ...state.saved, [state.form.tool]: settingsOf(state.form) };
      const form = formFromGeneration(action.generation, state.models);
      const used = state.models.find((candidate) => candidate.id === form.modelId);
      const demoChosen =
        used && isDemoModel(used)
          ? { ...state.demoChosen, [form.tool]: true as const }
          : state.demoChosen;
      return { ...state, saved, demoChosen, form };
    }
    case 'prefill': {
      let next = state;
      if (action.tool && action.tool !== state.form.tool)
        next = studioReducer(next, { type: 'tool', tool: action.tool });
      if (action.modelId) next = studioReducer(next, { type: 'model', modelId: action.modelId });
      if (action.prompt !== undefined) {
        next = { ...next, form: { ...next.form, prompt: action.prompt } };
      }
      return next;
    }
  }
}

// ---- The request ---------------------------------------------------------------------------------

const ARABIC_INDIC_ZERO = 0x0660;

/** Digits as typed on an Arabic keyboard (٠-٩) become 0-9; anything that is not a digit is dropped. */
export function toAsciiDigits(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char >= '0' && char <= '9') out += char;
    else if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    }
  }
  return out;
}

/** The seed field as a number: undefined when empty, null when it is not a valid seed. */
export function parseSeed(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (!/^\d{1,10}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= MAX_SEED ? value : null;
}

/** The parameters the form asks for, with only the options `model` offers. */
export function buildParams(form: StudioForm, model: ModelDTO): GenerationParams {
  const { limits } = model;
  const params: GenerationParams = {
    aspectRatio: form.aspectRatio ?? limits.defaultAspectRatio,
    count: Math.min(Math.max(form.count ?? limits.defaultCount, 1), limits.maxCount),
  };
  if (limits.durations?.length) {
    params.durationSec = form.durationSec ?? limits.defaultDuration ?? limits.durations[0];
  }
  if (limits.resolutions?.length) {
    params.resolution = form.resolution ?? limits.defaultResolution ?? limits.resolutions[0];
  }
  const seed = parseSeed(form.seed);
  if (limits.supportsSeed && typeof seed === 'number') params.seed = seed;
  if (limits.supportsStrength && toolNeedsImage(form.tool)) {
    params.strength = form.strength ?? DEFAULT_STRENGTH;
  }
  return params;
}

/** Credits the form will cost, from the same function the server uses; null when it cannot be priced. */
export function costOf(form: StudioForm, model: ModelDTO | undefined): number | null {
  if (!model) return null;
  try {
    return computeCost(toModelSpec(model), buildParams(form, model));
  } catch {
    return null;
  }
}

export function buildRequest(
  form: StudioForm,
  model: ModelDTO,
  inputAssetId: string | undefined,
): CreateGenerationRequest {
  const params: Partial<GenerationParams> = { ...buildParams(form, model) };
  // A model that keeps the input image's shape has no aspect ratio to choose; the server would
  // ignore it, so it is simply not sent.
  if (!showsAspect(model, form.tool)) delete params.aspectRatio;
  const negative = form.negativePrompt.trim();
  return {
    tool: form.tool,
    modelId: model.id,
    prompt: form.prompt.trim(),
    ...(model.limits.supportsNegativePrompt && negative ? { negativePrompt: negative } : {}),
    params,
    ...(toolNeedsImage(form.tool) && inputAssetId ? { inputAssetId } : {}),
    isPublic: form.isPublic,
  };
}

// ---- What is missing -----------------------------------------------------------------------------

export type FormProblem =
  | { field: 'prompt'; code: 'required' }
  | { field: 'prompt'; code: 'too_long'; max: number }
  | { field: 'inputAssetId'; code: 'required' | 'uploading' }
  | { field: 'seed'; code: 'invalid' }
  | { field: 'modelId'; code: 'required' };

export type InputProgress = 'none' | 'busy' | 'ready';

/** Everything that stops the form from being sent, in the order the fields appear. */
export function formProblems(
  form: StudioForm,
  model: ModelDTO | undefined,
  input: InputProgress,
): FormProblem[] {
  const problems: FormProblem[] = [];
  if (!model) {
    problems.push({ field: 'modelId', code: 'required' });
    return problems;
  }
  const prompt = form.prompt.trim();
  if (prompt === '') problems.push({ field: 'prompt', code: 'required' });
  else if (charCount(prompt) > model.limits.maxPromptChars) {
    problems.push({ field: 'prompt', code: 'too_long', max: model.limits.maxPromptChars });
  }
  if (toolNeedsImage(form.tool)) {
    if (input === 'none') problems.push({ field: 'inputAssetId', code: 'required' });
    if (input === 'busy') problems.push({ field: 'inputAssetId', code: 'uploading' });
  }
  if (model.limits.supportsSeed && parseSeed(form.seed) === null) {
    problems.push({ field: 'seed', code: 'invalid' });
  }
  return problems;
}
