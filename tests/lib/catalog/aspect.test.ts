import { describe, expect, it } from 'vitest';
import {
  aspectCss,
  aspectPixelSize,
  aspectTerms,
  aspectValue,
  isAspectRatio,
} from '@/lib/catalog/aspect';
import { ASPECT_RATIOS } from '@/lib/catalog/types';

describe('aspect ratio helpers', () => {
  it('recognizes the supported ratios only', () => {
    for (const ratio of ASPECT_RATIOS) expect(isAspectRatio(ratio)).toBe(true);
    expect(isAspectRatio('5:4')).toBe(false);
    expect(isAspectRatio(1)).toBe(false);
  });

  it('splits a ratio into its terms', () => {
    expect(aspectTerms('21:9')).toEqual({ width: 21, height: 9 });
    expect(aspectTerms('9:16')).toEqual({ width: 9, height: 16 });
  });

  it('computes the numeric ratio', () => {
    expect(aspectValue('1:1')).toBe(1);
    expect(aspectValue('16:9')).toBeCloseTo(1.7778, 4);
    expect(aspectValue('9:16')).toBeCloseTo(0.5625, 4);
    expect(aspectValue('3:2')).toBe(1.5);
  });

  it('formats the CSS aspect-ratio value', () => {
    expect(aspectCss('16:9')).toBe('16 / 9');
    expect(aspectCss('1:1')).toBe('1 / 1');
    expect(aspectCss('2:3')).toBe('2 / 3');
  });
});

describe('aspectPixelSize', () => {
  const MEGAPIXEL = 1024 * 1024;

  it('returns exact squares for 1:1', () => {
    expect(aspectPixelSize('1:1', MEGAPIXEL)).toEqual({ width: 1024, height: 1024 });
    expect(aspectPixelSize('1:1', 512 * 512, 64)).toEqual({ width: 512, height: 512 });
  });

  it.each(ASPECT_RATIOS)(
    '%s stays within the budget, on the grid and close to the ratio',
    (ratio) => {
      for (const step of [8, 16, 64]) {
        const { width, height } = aspectPixelSize(ratio, MEGAPIXEL, step);
        expect(width % step).toBe(0);
        expect(height % step).toBe(0);
        expect(width * height).toBeLessThanOrEqual(MEGAPIXEL);
        // Within one grid step of the exact proportions, and using most of the budget.
        expect(Math.abs(width / height - aspectValue(ratio)) / aspectValue(ratio)).toBeLessThan(
          (step * 1.2) / Math.min(width, height),
        );
        expect(width * height).toBeGreaterThan(MEGAPIXEL * 0.85);
      }
    },
  );

  it('orients landscape and portrait correctly', () => {
    const wide = aspectPixelSize('16:9', MEGAPIXEL);
    const tall = aspectPixelSize('9:16', MEGAPIXEL);
    expect(wide.width).toBeGreaterThan(wide.height);
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide).toEqual({ width: tall.height, height: tall.width });
  });

  it('gives the familiar sizes at one megapixel', () => {
    expect(aspectPixelSize('16:9', MEGAPIXEL)).toEqual({ width: 1360, height: 768 });
    expect(aspectPixelSize('4:3', MEGAPIXEL, 64)).toEqual({ width: 1152, height: 896 });
  });

  it('handles budgets smaller than one grid cell without looping forever', () => {
    expect(aspectPixelSize('16:9', 10, 8)).toEqual({ width: 8, height: 8 });
  });

  it('validates its arguments', () => {
    expect(() => aspectPixelSize('1:1', 0)).toThrow(RangeError);
    expect(() => aspectPixelSize('1:1', -5)).toThrow(RangeError);
    expect(() => aspectPixelSize('1:1', MEGAPIXEL, 0)).toThrow(RangeError);
    expect(() => aspectPixelSize('1:1', MEGAPIXEL, 1.5)).toThrow(RangeError);
  });
});
