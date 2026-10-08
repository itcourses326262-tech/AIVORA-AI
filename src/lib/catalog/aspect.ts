import { ASPECT_RATIOS, type AspectRatio } from './types';

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && (ASPECT_RATIOS as readonly string[]).includes(value);
}

/** `'16:9'` -> `{ width: 16, height: 9 }` (the ratio's terms, not pixels). */
export function aspectTerms(ratio: AspectRatio): { width: number; height: number } {
  const [width, height] = ratio.split(':').map(Number);
  return { width: width as number, height: height as number };
}

/** Width divided by height: 16:9 -> 1.777..., 9:16 -> 0.5625. */
export function aspectValue(ratio: AspectRatio): number {
  const { width, height } = aspectTerms(ratio);
  return width / height;
}

/** Value for the CSS `aspect-ratio` property: '16:9' -> '16 / 9'. */
export function aspectCss(ratio: AspectRatio): string {
  const { width, height } = aspectTerms(ratio);
  return `${width} / ${height}`;
}

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * Largest size with the given ratio whose area stays within `pixelBudget`, with both sides
 * multiples of `multipleOf` (most diffusion models want 8, 16 or 64). The ratio may drift slightly
 * because of that rounding, the area never exceeds the budget.
 */
export function aspectPixelSize(
  ratio: AspectRatio,
  pixelBudget: number,
  multipleOf: number = 8,
): PixelSize {
  if (!(pixelBudget > 0) || !Number.isInteger(multipleOf) || multipleOf < 1) {
    throw new RangeError('pixelBudget must be positive and multipleOf a positive integer');
  }
  const value = aspectValue(ratio);
  const idealWidth = Math.sqrt(pixelBudget * value);
  const idealHeight = idealWidth / value;
  const snap = (side: number) => Math.max(multipleOf, Math.round(side / multipleOf) * multipleOf);

  let width = snap(idealWidth);
  let height = snap(idealHeight);
  while (width * height > pixelBudget && (width > multipleOf || height > multipleOf)) {
    // Shrink the side that was rounded up the most, so the ratio stays as close as possible.
    const widthExcess = width / idealWidth;
    const heightExcess = height / idealHeight;
    if (widthExcess >= heightExcess && width > multipleOf) width -= multipleOf;
    else if (height > multipleOf) height -= multipleOf;
    else width -= multipleOf;
  }
  return { width, height };
}
