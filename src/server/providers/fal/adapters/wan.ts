import 'server-only';
import { inputImageDataUri } from '../image-input';
import {
  compact,
  durationOf,
  negativePromptOf,
  resolutionOf,
  seedOf,
  type FalAdapter,
} from './shared';

/** fal documents a 500 character cap on the Wan negative prompt. */
const MAX_NEGATIVE_CHARS = 500;

/**
 * Wan 2.6 text to video: wan/v2.6/text-to-video. `duration` is the string "5", "10" or "15".
 * Prompt rewriting stays on (fal's default, it helps short prompts) but `multi_shots` is turned off:
 * its default would cut the clip into several shots, and the catalog sells one continuous clip.
 */
export const wanTextToVideo: FalAdapter = {
  async buildInput(input) {
    return compact({
      prompt: input.prompt,
      aspect_ratio: input.params.aspectRatio,
      resolution: resolutionOf(input),
      duration: String(durationOf(input)),
      multi_shots: false,
      negative_prompt: negativePromptOf(input, MAX_NEGATIVE_CHARS),
      seed: seedOf(input),
    });
  },
};

/**
 * Wan 2.6 image to video: wan/v2.6/image-to-video. The image is the first frame ("publicly
 * accessible or base64 data URI", sides between 240 and 7680 px) and there is no aspect_ratio
 * field: the video follows the image. Transparency is flattened because Wan's own API rejects it.
 */
export const wanImageToVideo: FalAdapter = {
  async buildInput(input) {
    return compact({
      prompt: input.prompt,
      image_url: await inputImageDataUri(input, {
        minSide: 240,
        maxSide: 2048,
        maxBytes: 4 * 1024 * 1024,
        opaque: true,
      }),
      resolution: resolutionOf(input),
      duration: String(durationOf(input)),
      multi_shots: false,
      negative_prompt: negativePromptOf(input, MAX_NEGATIVE_CHARS),
      seed: seedOf(input),
    });
  },
};
