import 'server-only';
import { aspectTerms, type PixelSize } from '@/lib/catalog/aspect';
import type { AspectRatio } from '@/lib/catalog/types';

/** Demo images are about one megapixel (1:1 is 1024x1024, 16:9 is 1280x720). */
export const IMAGE_PIXEL_BUDGET = 1024 * 1024;
/** Demo videos are a small preview: the longest side is this many pixels. */
export const VIDEO_LONGEST_SIDE = 480;

const MIN_VIDEO_SIDE = 32;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/**
 * The largest size with exactly the requested ratio whose area stays within one megapixel and
 * whose sides are multiples of 8 (so no rounding drift, unlike `aspectPixelSize`).
 */
export function mockImageSize(ratio: AspectRatio): PixelSize {
  const terms = aspectTerms(ratio);
  const divisor = gcd(terms.width, terms.height);
  const a = terms.width / divisor;
  const b = terms.height / divisor;
  const step = lcm(8 / gcd(8, a), 8 / gcd(8, b));
  const largest = Math.floor(Math.sqrt(IMAGE_PIXEL_BUDGET / (a * b)));
  const k = Math.max(step, largest - (largest % step));
  return { width: a * k, height: b * k };
}

/** An uploaded image's size, shrunk (never enlarged) to about one megapixel with the same aspect ratio. */
export function fitImageToBudget(width: number, height: number): PixelSize {
  if (width * height <= IMAGE_PIXEL_BUDGET) return { width, height };
  const scale = Math.sqrt(IMAGE_PIXEL_BUDGET / (width * height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

const even = (value: number) => Math.max(MIN_VIDEO_SIDE, 2 * Math.round(value / 2));

/** The preview size for a video whose frames have the given proportions: 480 px on the longest side. */
export function videoSizeFor(width: number, height: number): PixelSize {
  const longest = Math.max(width, height);
  return {
    width: even((VIDEO_LONGEST_SIDE * width) / longest),
    height: even((VIDEO_LONGEST_SIDE * height) / longest),
  };
}

export function videoSizeForRatio(ratio: AspectRatio): PixelSize {
  const { width, height } = aspectTerms(ratio);
  return videoSizeFor(width, height);
}
