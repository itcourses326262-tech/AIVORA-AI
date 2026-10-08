/*
 * Input fields of the endpoints in the fal catalog, copied from the generated endpoint types that
 * ship in `@fal-ai/client` 1.11.0-alpha.5 (published 2026-10-06). The adapters' request bodies are
 * checked against this in adapters.test.ts, so a typo'd field or an enum value fal does not
 * accept fails a test instead of a paid request. Refresh it when an endpoint changes.
 */

export type FieldRule =
  | 'string'
  | 'number'
  | 'boolean'
  /** A URL or a base64 data URI. */
  | 'file'
  | 'files'
  /** A preset name or { width, height }. */
  | 'image_size'
  /** One of these values. */
  | readonly string[];

export interface EndpointSchema {
  required: readonly string[];
  fields: Readonly<Record<string, FieldRule>>;
}

export const FAL_INPUT_SCHEMAS: Readonly<Record<string, EndpointSchema>> = {
  'fal-ai/flux/schnell': {
    required: ['prompt'],
    fields: {
      acceleration: ['none', 'regular', 'high'],
      enable_safety_checker: 'boolean',
      guidance_scale: 'number',
      image_size: 'image_size',
      num_images: 'number',
      num_inference_steps: 'number',
      output_format: ['jpeg', 'png'],
      prompt: 'string',
      seed: 'number',
      sync_mode: 'boolean',
    },
  },
  'fal-ai/flux-2-pro': {
    required: ['prompt'],
    fields: {
      enable_safety_checker: 'boolean',
      image_size: 'image_size',
      output_format: ['jpeg', 'png'],
      prompt: 'string',
      safety_tolerance: ['1', '2', '3', '4', '5'],
      seed: 'number',
      sync_mode: 'boolean',
    },
  },
  'fal-ai/flux/dev/image-to-image': {
    required: ['image_url', 'prompt'],
    fields: {
      acceleration: ['none', 'regular', 'high'],
      enable_safety_checker: 'boolean',
      guidance_scale: 'number',
      image_url: 'file',
      num_images: 'number',
      num_inference_steps: 'number',
      output_format: ['jpeg', 'png'],
      prompt: 'string',
      seed: 'number',
      strength: 'number',
      sync_mode: 'boolean',
    },
  },
  'fal-ai/nano-banana-pro': {
    required: ['prompt'],
    fields: {
      aspect_ratio: [
        'auto',
        '21:9',
        '16:9',
        '3:2',
        '4:3',
        '5:4',
        '1:1',
        '4:5',
        '3:4',
        '2:3',
        '9:16',
      ],
      enable_web_search: 'boolean',
      limit_generations: 'boolean',
      num_images: 'number',
      output_format: ['jpeg', 'png', 'webp'],
      prompt: 'string',
      resolution: ['1K', '2K', '4K'],
      safety_tolerance: ['1', '2', '3', '4', '5', '6'],
      seed: 'number',
      sync_mode: 'boolean',
      system_prompt: 'string',
    },
  },
  'fal-ai/nano-banana-pro/edit': {
    required: ['image_urls', 'prompt'],
    fields: {
      aspect_ratio: [
        'auto',
        '21:9',
        '16:9',
        '3:2',
        '4:3',
        '5:4',
        '1:1',
        '4:5',
        '3:4',
        '2:3',
        '9:16',
      ],
      enable_web_search: 'boolean',
      image_urls: 'files',
      limit_generations: 'boolean',
      num_images: 'number',
      output_format: ['jpeg', 'png', 'webp'],
      prompt: 'string',
      resolution: ['1K', '2K', '4K'],
      safety_tolerance: ['1', '2', '3', '4', '5', '6'],
      seed: 'number',
      sync_mode: 'boolean',
      system_prompt: 'string',
    },
  },
  'wan/v2.6/text-to-video': {
    required: ['prompt'],
    fields: {
      aspect_ratio: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      audio_url: 'file',
      duration: ['5', '10', '15'],
      enable_prompt_expansion: 'boolean',
      enable_safety_checker: 'boolean',
      multi_shots: 'boolean',
      negative_prompt: 'string',
      prompt: 'string',
      resolution: ['720p', '1080p'],
      seed: 'number',
    },
  },
  'wan/v2.6/image-to-video': {
    required: ['image_url', 'prompt'],
    fields: {
      audio_url: 'file',
      duration: ['5', '10', '15'],
      enable_prompt_expansion: 'boolean',
      enable_safety_checker: 'boolean',
      image_url: 'file',
      multi_shots: 'boolean',
      negative_prompt: 'string',
      prompt: 'string',
      resolution: ['720p', '1080p'],
      seed: 'number',
    },
  },
  'fal-ai/veo3.1/fast': {
    required: ['prompt'],
    fields: {
      aspect_ratio: ['16:9', '9:16'],
      auto_fix: 'boolean',
      duration: ['4s', '6s', '8s'],
      generate_audio: 'boolean',
      negative_prompt: 'string',
      prompt: 'string',
      resolution: ['720p', '1080p', '4k'],
      safety_tolerance: ['1', '2', '3', '4', '5', '6'],
      seed: 'number',
    },
  },
  'fal-ai/veo3.1/fast/image-to-video': {
    required: ['image_url', 'prompt'],
    fields: {
      aspect_ratio: ['auto', '16:9', '9:16'],
      auto_fix: 'boolean',
      duration: ['4s', '6s', '8s'],
      generate_audio: 'boolean',
      image_url: 'file',
      negative_prompt: 'string',
      prompt: 'string',
      resolution: ['720p', '1080p', '4k'],
      safety_tolerance: ['1', '2', '3', '4', '5', '6'],
      seed: 'number',
    },
  },
};
