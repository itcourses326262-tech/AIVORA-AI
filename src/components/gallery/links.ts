/**
 * Where the gallery, Explore and the share page send people. The studio builds its own address
 * (`studioHref`); this file decides what to put in it.
 */
import { studioHref } from '@/components/studio/prefill';
import { getModel } from '@/lib/catalog';
import type { Tool } from '@/lib/catalog/types';
import type { GenerationDTO } from '@/lib/api-types';
import { toolNeedsImage } from '@/lib/tools';

/**
 * The detail page of one of the user's own creations. `result` (0-based) is the picture to open
 * first: a tile of a card that holds several results opens its own, not always the first.
 */
export function detailHref(id: string, result = 0): string {
  return result > 0 ? `/gallery/${id}?r=${Math.trunc(result) + 1}` : `/gallery/${id}`;
}

/** The result a detail address asks for (`?r=2` is the second), clamped to what exists. */
export function resultFromQuery(value: string | string[] | undefined, count: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const number = raw !== undefined && /^\d{1,3}$/.test(raw) ? Number(raw) : 1;
  return Math.min(Math.max(number, 1), Math.max(count, 1)) - 1;
}

/** The public page of a shared creation. */
export function sharePath(id: string): string {
  return `/s/${id}`;
}

/**
 * "Reuse settings": the studio opens on the same tool, model and prompt, and for an image tool also
 * on the same input picture (it is the owner's own, so the studio may use it).
 */
export function reuseHref(
  generation: Pick<GenerationDTO, 'tool' | 'modelId' | 'prompt' | 'input'>,
): string {
  return studioHref({
    tool: generation.tool,
    modelId: generation.modelId,
    prompt: generation.prompt,
    ...(toolNeedsImage(generation.tool) && generation.input
      ? { inputAssetId: generation.input.id }
      : {}),
  });
}

/** Starts an image tool from a result: `image-to-image` edits it, `image-to-video` animates it. */
export function inputHref(
  tool: Extract<Tool, 'image-to-image' | 'image-to-video'>,
  assetId: string,
): string {
  return studioHref({ tool, inputAssetId: assetId });
}

/**
 * The longest `/studio?...` address a remix link may have. A visitor who follows it is sent to
 * `/login?next=<address>`, and `safeNextPath` ignores a `next` longer than 2048 characters: a long
 * prompt (an Arabic letter takes six characters once percent-encoded) would silently lose the
 * whole remix. The prompt is cut to fit instead.
 */
const MAX_REMIX_ADDRESS = 1900;

/** The longest prefix of `text`, by whole characters, for which `fits` still holds. */
function longestFitting(text: string, fits: (candidate: string) => boolean): string {
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(chars.slice(0, middle).join(''))) low = middle;
    else high = middle - 1;
  }
  return chars.slice(0, low).join('').trimEnd();
}

/**
 * "Remix" of a public creation. Its input picture is never shared, so an image-to-* creation is
 * remixed with the text tool of the same kind; the model is kept when that tool offers it.
 */
export function remixHref(creation: { kind: 'image' | 'video'; modelId: string; prompt: string }) {
  const tool: Tool = creation.kind === 'image' ? 'text-to-image' : 'text-to-video';
  const model = getModel(creation.modelId);
  const prefill = {
    tool,
    ...(model?.tools.includes(tool) ? { modelId: model.id } : {}),
  };
  const prompt = longestFitting(
    creation.prompt,
    (candidate) => studioHref({ ...prefill, prompt: candidate }).length <= MAX_REMIX_ADDRESS,
  );
  return studioHref({ ...prefill, prompt });
}
