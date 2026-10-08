/**
 * The query string of `/studio`: `tool`, `model`, `prompt` and `input` (an asset id). It is how the
 * gallery sends a result back into the studio, so `studioHref` is the one place that builds it and
 * `parsePrefill` the one place that reads it. Everything in a URL is untrusted: a value that does
 * not fit is dropped rather than half-applied.
 */
import { getModel } from '@/lib/catalog';
import type { Tool } from '@/lib/catalog/types';
import { isValidId } from '@/lib/id';
import { isTool, toolNeedsImage } from '@/lib/tools';

export interface StudioPrefill {
  tool?: Tool;
  modelId?: string;
  prompt?: string;
  /** An asset to use as the input image (an upload or one of the user's own results). */
  inputAssetId?: string;
}

const MAX_PROMPT_PARAM = 4000;
const MAX_MODEL_PARAM = 100;

type RawParams = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parsePrefill(params: RawParams): StudioPrefill {
  const rawTool = first(params.tool);
  const rawModel = first(params.model)?.trim();
  const rawPrompt = first(params.prompt)?.trim();
  const rawInput = first(params.input)?.trim();

  const modelId = rawModel && rawModel.length <= MAX_MODEL_PARAM ? rawModel : undefined;
  const prompt = rawPrompt ? rawPrompt.slice(0, MAX_PROMPT_PARAM) : undefined;
  const inputAssetId = rawInput && isValidId(rawInput, 'ast') ? rawInput : undefined;

  let tool: Tool | undefined = isTool(rawTool) ? rawTool : undefined;
  // A model alone implies a tool it serves; an input image alone implies editing it.
  if (!tool && modelId) tool = getModel(modelId)?.tools[0];
  if (!tool && inputAssetId) tool = 'image-to-image';

  return {
    ...(tool ? { tool } : {}),
    ...(modelId ? { modelId } : {}),
    ...(prompt ? { prompt } : {}),
    // Text-to-image and text-to-video take no input image.
    ...(inputAssetId && (!tool || toolNeedsImage(tool)) ? { inputAssetId } : {}),
  };
}

/** True when the URL asked for nothing (a plain `/studio`). */
export function isEmptyPrefill(prefill: StudioPrefill): boolean {
  return Object.keys(prefill).length === 0;
}

/** Stable text for a prefill, to tell "the same request again" from a new one. */
export function prefillKey(prefill: StudioPrefill): string {
  return isEmptyPrefill(prefill) ? '' : JSON.stringify(prefill);
}

/**
 * `/studio?...` for a link from another page, e.g. `studioHref({ tool: 'image-to-video',
 * inputAssetId: asset.id })` for a "Animate" button in the gallery.
 */
export function studioHref(prefill: StudioPrefill = {}): string {
  const query = new URLSearchParams();
  if (prefill.tool) query.set('tool', prefill.tool);
  if (prefill.modelId) query.set('model', prefill.modelId);
  if (prefill.prompt) query.set('prompt', prefill.prompt);
  if (prefill.inputAssetId) query.set('input', prefill.inputAssetId);
  const text = query.toString();
  return text ? `/studio?${text}` : '/studio';
}
