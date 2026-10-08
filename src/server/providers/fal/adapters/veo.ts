import 'server-only';
import { inputImageDataUri } from '../image-input';
import {
  compact,
  durationOf,
  negativePromptOf,
  resolutionOf,
  SAFETY_TOLERANCE,
  seedOf,
  type FalAdapter,
} from './shared';

/*
 * Moderation for both Veo endpoints: `safety_tolerance` is pinned and `auto_fix` is off. With
 * auto_fix on (fal's default) a prompt that fails the content rules is silently rewritten and
 * generated from the rewrite, so a request the platform would have refused reaches the public feed
 * with no signal. Off, fal answers with a content_policy_violation, which maps to `content_policy`
 * and refunds the user.
 */

/**
 * Veo 3.1 Fast text to video: fal-ai/veo3.1/fast. `duration` is "4s", "6s" or "8s" and audio is
 * always requested (the catalog price includes it: 0.15 USD/s against 0.10 without).
 */
export const veoTextToVideo: FalAdapter = {
  async buildInput(input) {
    return compact({
      prompt: input.prompt,
      aspect_ratio: input.params.aspectRatio,
      duration: `${durationOf(input)}s`,
      resolution: resolutionOf(input),
      generate_audio: true,
      auto_fix: false,
      safety_tolerance: SAFETY_TOLERANCE,
      negative_prompt: negativePromptOf(input),
      seed: seedOf(input),
    });
  },
};

/**
 * Veo 3.1 Fast image to video: fal-ai/veo3.1/fast/image-to-video. The image should be 720p or
 * larger; one that is not 16:9 or 9:16 is cropped to the chosen ratio by fal. Inputs up to 8 MB
 * (jpg, png, webp, gif, avif) are accepted, ours are capped lower.
 */
export const veoImageToVideo: FalAdapter = {
  async buildInput(input) {
    return compact({
      prompt: input.prompt,
      image_url: await inputImageDataUri(input, { maxSide: 2048, maxBytes: 4 * 1024 * 1024 }),
      aspect_ratio: input.params.aspectRatio,
      duration: `${durationOf(input)}s`,
      resolution: resolutionOf(input),
      generate_audio: true,
      auto_fix: false,
      safety_tolerance: SAFETY_TOLERANCE,
      negative_prompt: negativePromptOf(input),
      seed: seedOf(input),
    });
  },
};
