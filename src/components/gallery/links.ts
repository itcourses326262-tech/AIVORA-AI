/**
 * Where the gallery, Explore and the share page send people. The studio builds its own address
 * (`studioHref`); this file decides what to put in it.
 */
import { studioHref } from '@/components/studio/prefill';
import { getModel } from '@/lib/catalog';
import type { Tool } from '@/lib/catalog/types';
import type { GenerationDTO } from '@/lib/api-types';
import { toolNeedsImage } from '@/lib/tools';

/** The detail page of one of the user's own creations. */
export function detailHref(id: string): string {
  return `/gallery/${id}`;
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
 * "Remix" of a public creation. Its input picture is never shared, so an image-to-* creation is
 * remixed with the text tool of the same kind; the model is kept when that tool offers it.
 */
export function remixHref(creation: { kind: 'image' | 'video'; modelId: string; prompt: string }) {
  const tool: Tool = creation.kind === 'image' ? 'text-to-image' : 'text-to-video';
  const model = getModel(creation.modelId);
  return studioHref({
    tool,
    ...(model?.tools.includes(tool) ? { modelId: model.id } : {}),
    prompt: creation.prompt,
  });
}
