import 'server-only';
import { inputImageDataUri } from '../image-input';
import { compact, seedOf, type FalAdapter } from './shared';

/**
 * Nano Banana Pro: fal-ai/nano-banana-pro. The documented aspect_ratio enum covers every ratio of
 * our catalog. Always 1K (4K costs double). No negative prompt field exists.
 */
export const nanoBananaPro: FalAdapter = {
  async buildInput(input) {
    return compact({
      prompt: input.prompt,
      aspect_ratio: input.params.aspectRatio,
      resolution: '1K',
      num_images: input.params.count,
      seed: seedOf(input),
    });
  },
};

/**
 * Nano Banana Pro edit: fal-ai/nano-banana-pro/edit takes up to 14 reference images in
 * `image_urls`. `aspect_ratio: auto` keeps the proportions of the first image.
 */
export const nanoBananaProEdit: FalAdapter = {
  async buildInput(input) {
    return compact({
      prompt: input.prompt,
      image_urls: [await inputImageDataUri(input, { maxSide: 2048, maxBytes: 4 * 1024 * 1024 })],
      aspect_ratio: 'auto',
      resolution: '1K',
      num_images: input.params.count,
      seed: seedOf(input),
    });
  },
};
