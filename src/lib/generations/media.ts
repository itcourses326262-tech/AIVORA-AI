/**
 * What the UI needs to know about the files of a generation: how to show them (the Demo video is an
 * animated GIF, which is an `<img>`), where to download them and how big their box should be before
 * they have loaded.
 */
import type { AssetDTO, GenerationDTO } from '@/lib/api-types';
import { aspectValue } from '@/lib/catalog/aspect';
import { toolNeedsImage } from '@/lib/tools';

/** How a result is put on the page. */
export type MediaPresentation = 'image' | 'animated-image' | 'video';

/** The Demo video is a looping GIF (`kind: 'video'`, `image/gif`): an `<img>` plays it. */
export function presentationOf(asset: AssetDTO): MediaPresentation {
  if (asset.mimeType.startsWith('image/')) {
    return asset.kind === 'video' || asset.mimeType === 'image/gif' ? 'animated-image' : 'image';
  }
  return 'video';
}

/** The media URL that makes the browser save the file instead of showing it. */
export function downloadHref(asset: AssetDTO): string {
  return `${asset.url}${asset.url.includes('?') ? '&' : '?'}download=1`;
}

/** The public page of a shared generation. `origin` is `window.location.origin`. */
export function shareHref(origin: string, generationId: string): string {
  return `${origin}/s/${generationId}`;
}

/** Width divided by height of a file, when both are known. */
export function assetAspect(asset: AssetDTO | undefined): number | undefined {
  if (!asset?.width || !asset.height) return undefined;
  return asset.width / asset.height;
}

/**
 * Width divided by height for the box of a generation's media. Results use their real size; while
 * a generation is still running, tools with an input image follow that image (the models keep its
 * proportions) and the others follow the requested ratio.
 */
export function generationAspect(generation: GenerationDTO): number {
  const fromOutput = assetAspect(generation.outputs[0]);
  if (fromOutput !== undefined) return fromOutput;
  if (toolNeedsImage(generation.tool)) {
    const fromInput = assetAspect(generation.input);
    if (fromInput !== undefined) return fromInput;
  }
  return aspectValue(generation.params.aspectRatio);
}

/** Kept so a box never becomes a sliver or a tower; extreme files are letterboxed inside it. */
export function boundedAspect(aspect: number): number {
  return Math.min(2.4, Math.max(0.5, aspect));
}

/** Whether a generation is still being worked on. */
export function isActive(generation: Pick<GenerationDTO, 'status'>): boolean {
  return generation.status === 'queued' || generation.status === 'processing';
}

/** The words of a prompt that a screen reader can say as the name of a result. */
export function promptLabel(prompt: string, max = 140): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

/** Height of a card's text block (prompt, model, cost, time) below its media. */
const CARD_FOOTER_PX = 92;
/** The least height of the placeholder of a running generation (`min-h-60`). */
const ACTIVE_MIN_MEDIA_PX = 240;
/** The least height of the panel that explains a failed or canceled generation (`min-h-52`). */
const OUTCOME_MIN_MEDIA_PX = 208;

/**
 * Height of the results of a finished generation at `width` pixels. One result fills the width;
 * several sit in two columns; three show the first across both columns and the other two below it
 * (see `ResultsBody`), so there is never an empty cell.
 */
function resultsHeight(count: number, width: number, aspect: number): number {
  const cell = width / 2 / aspect;
  if (count <= 1) return width / aspect;
  if (count === 3) return 2 * cell + cell;
  return Math.ceil(count / 2) * cell;
}

/**
 * About how tall a `GenerationCard` is at `width` pixels, from what is known before it is drawn.
 * `Masonry` uses it to pick the shortest column; it only has to be close, not exact.
 */
export function estimateCardHeight(generation: GenerationDTO, width: number): number {
  const aspect = boundedAspect(generationAspect(generation));
  const count = Math.max(generation.outputs.length, 1);
  const media =
    generation.status === 'failed' || generation.status === 'canceled'
      ? OUTCOME_MIN_MEDIA_PX
      : generation.status === 'succeeded'
        ? resultsHeight(count, width, aspect)
        : Math.max(ACTIVE_MIN_MEDIA_PX, width / aspect);
  return media + CARD_FOOTER_PX;
}
