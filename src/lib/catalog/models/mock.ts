import type { AspectRatio, ModelSpec } from '../types';

const ASPECT_RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];

/**
 * The Demo models: served by the built-in mock provider (`server/providers/mock`), which needs no
 * API key. They are listed whenever `ENABLE_MOCK_PROVIDER` is on, so a fresh install can generate
 * right away. The image model paints procedural artwork; the video model produces a short looping
 * GIF "motion preview" (always a small preview, whatever resolution is chosen: the resolution only
 * sets the price).
 */
export const mockModels: ModelSpec[] = [
  {
    id: 'aivore-demo-image',
    provider: 'mock',
    providerModel: 'aivore/demo-image',
    kind: 'image',
    tools: ['text-to-image', 'image-to-image'],
    label: 'AIVORE Demo Image',
    description: {
      en: 'Instant demo artwork with no API key: colourful procedural images shaped by your prompt and seed. Great for trying the studio before connecting a real model.',
      ar: 'صور تجريبية فورية دون أي مفتاح API: لوحات فنية إجرائية تتشكل بحسب وصفك وبذرتك. مناسبة لتجربة الاستوديو قبل ربط نموذج حقيقي.',
    },
    badges: ['demo'],
    limits: {
      maxPromptChars: 2000,
      aspectRatios: ASPECT_RATIOS,
      defaultAspectRatio: '1:1',
      maxCount: 4,
      defaultCount: 1,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsStrength: true,
    },
    pricing: { type: 'image', perImage: 1 },
  },
  {
    id: 'aivore-demo-video',
    provider: 'mock',
    providerModel: 'aivore/demo-video',
    kind: 'video',
    tools: ['text-to-video', 'image-to-video'],
    label: 'AIVORE Demo Video',
    description: {
      en: 'Instant demo motion preview with no API key: a short looping animation (GIF) generated from your prompt, or a gentle camera move over your image.',
      ar: 'معاينة حركية تجريبية فورية دون أي مفتاح API: رسم متحرك قصير ومتكرر (GIF) يُولَّد من وصفك، أو حركة كاميرا هادئة فوق صورتك.',
    },
    badges: ['demo'],
    limits: {
      maxPromptChars: 1000,
      aspectRatios: ASPECT_RATIOS,
      defaultAspectRatio: '16:9',
      maxCount: 1,
      defaultCount: 1,
      durations: [3, 5],
      defaultDuration: 3,
      resolutions: ['480p', '720p'],
      defaultResolution: '480p',
      supportsNegativePrompt: false,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'video', perSecond: { '480p': 2, '720p': 3 } },
  },
];
