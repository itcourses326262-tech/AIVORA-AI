/** Catalog vocabulary shared by the server, the API and the UI. See docs/ARCHITECTURE.md section 5. */

export const TOOLS = [
  'text-to-image',
  'image-to-image',
  'text-to-video',
  'image-to-video',
] as const;
export type Tool = (typeof TOOLS)[number];

export const KINDS = ['image', 'video'] as const;
export type Kind = (typeof KINDS)[number];

export const PROVIDER_IDS = ['mock', 'openai', 'fal', 'replicate'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const MODEL_BADGES = ['fast', 'quality', 'new', 'demo', 'audio'] as const;
export type ModelBadge = (typeof MODEL_BADGES)[number];

export interface ModelLimits {
  maxPromptChars: number;
  aspectRatios: AspectRatio[];
  defaultAspectRatio: AspectRatio;
  /** Images: 1-4, video: 1. */
  maxCount: number;
  defaultCount: number;
  /** Video only, in seconds. */
  durations?: number[];
  defaultDuration?: number;
  resolutions?: Resolution[];
  defaultResolution?: Resolution;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  supportsStrength: boolean;
}

/** Prices are whole credits. */
export type ModelPricing =
  | { type: 'image'; perImage: number }
  | { type: 'video'; perSecond: Partial<Record<Resolution, number>> };

export interface ModelSpec {
  /** Stable public id, e.g. "flux-schnell". */
  id: string;
  provider: ProviderId;
  /** Upstream model id, e.g. "fal-ai/flux/schnell". */
  providerModel: string;
  kind: Kind;
  /** Which tools this model serves. */
  tools: Tool[];
  label: string;
  description: { en: string; ar: string };
  badges?: ModelBadge[];
  limits: ModelLimits;
  pricing: ModelPricing;
}

export interface GenerationParams {
  aspectRatio: AspectRatio;
  count: number;
  durationSec?: number;
  resolution?: Resolution;
  seed?: number;
  strength?: number;
}
