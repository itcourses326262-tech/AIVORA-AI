import 'server-only';
import { clamp } from '@/lib/utils';
import { inputImageDataUri } from '../image-input';
import { compact, FLUX_SIZES, SAFETY_TOLERANCE, seedOf, type FalAdapter } from './shared';

/** FLUX.1 [schnell]: fal-ai/flux/schnell. No negative prompt, no strength. */
export const fluxSchnell: FalAdapter = {
  async buildInput(input) {
    return compact({
      prompt: input.prompt,
      image_size: FLUX_SIZES[input.params.aspectRatio],
      num_images: input.params.count,
      enable_safety_checker: true,
      seed: seedOf(input),
    });
  },
};

/**
 * FLUX.2 [pro]: fal-ai/flux-2-pro. The schema has prompt, image_size (preset or width/height), seed,
 * safety_tolerance, enable_safety_checker and output_format but no num_images, so one image per
 * request. safety_tolerance is sent explicitly (1 strictest to 5) so that it cannot drift if fal
 * changes its default.
 */
export const flux2Pro: FalAdapter = {
  async buildInput(input) {
    return compact({
      prompt: input.prompt,
      image_size: FLUX_SIZES[input.params.aspectRatio],
      safety_tolerance: SAFETY_TOLERANCE,
      enable_safety_checker: true,
      seed: seedOf(input),
    });
  },
};

/**
 * FLUX.1 [dev] image to image: fal-ai/flux/dev/image-to-image. The schema has no image_size: the
 * output follows the input, which is shrunk to under 1 MP (the price assumes it) with sides that
 * are multiples of 16. `strength` (default 0.95 upstream) is only sent when the user chose one.
 */
export const fluxDevImg2Img: FalAdapter = {
  async buildInput(input) {
    const { strength } = input.params;
    return compact({
      prompt: input.prompt,
      image_url: await inputImageDataUri(input, {
        maxSide: 2048,
        maxPixels: 1_000_000,
        multipleOf: 16,
        maxBytes: 4 * 1024 * 1024,
      }),
      strength: strength === undefined ? undefined : clamp(strength, 0.01, 1),
      num_images: input.params.count,
      enable_safety_checker: true,
      seed: seedOf(input),
    });
  },
};
