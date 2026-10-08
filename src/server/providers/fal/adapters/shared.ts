import 'server-only';
import type { AspectRatio } from '@/lib/catalog/types';
import { ProviderError } from '../../errors';
import type { ProviderInput } from '../../types';

export type FalBody = Record<string, unknown>;

/** Maps one request to the JSON body of a fal endpoint. Only documented fields may be sent. */
export interface FalAdapter {
  buildInput(input: ProviderInput): Promise<FalBody>;
}

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * Output sizes for the FLUX endpoints, billed per megapixel. Every area stays under 1,000,000
 * pixels, so the price holds whether fal counts a megapixel as 10^6 or 2^20 pixels, and both sides
 * are multiples of 16 (what the FLUX VAE needs).
 */
export const FLUX_SIZES: Readonly<Record<AspectRatio, PixelSize>> = {
  '1:1': { width: 992, height: 992 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1152, height: 864 },
  '3:4': { width: 864, height: 1152 },
  '3:2': { width: 1200, height: 800 },
  '2:3': { width: 800, height: 1200 },
  '21:9': { width: 1344, height: 576 },
};

/** Drops undefined entries so that an unset option is simply not sent. */
export function compact(body: Record<string, unknown>): FalBody {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

/** The seed, only when the model takes one. */
export function seedOf(input: ProviderInput): number | undefined {
  return input.model.limits.supportsSeed ? input.params.seed : undefined;
}

/** The trimmed negative prompt, only when the model takes one and the user wrote one. */
export function negativePromptOf(input: ProviderInput, maxChars?: number): string | undefined {
  if (!input.model.limits.supportsNegativePrompt) return undefined;
  const text = input.negativePrompt?.trim();
  if (!text) return undefined;
  return maxChars === undefined ? text : text.slice(0, maxChars);
}

function requiredOf<T>(value: T | undefined, what: string, input: ProviderInput): T {
  if (value === undefined) {
    throw new ProviderError('invalid_input', `${input.model.id} request has no ${what}`);
  }
  return value;
}

export function durationOf(input: ProviderInput): number {
  return requiredOf(
    input.params.durationSec ?? input.model.limits.defaultDuration,
    'duration',
    input,
  );
}

export function resolutionOf(
  input: ProviderInput,
): NonNullable<ProviderInput['params']['resolution']> {
  return requiredOf(
    input.params.resolution ?? input.model.limits.defaultResolution,
    'resolution',
    input,
  );
}
