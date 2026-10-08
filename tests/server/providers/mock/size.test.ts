import { describe, expect, it } from 'vitest';
import { ASPECT_RATIOS } from '@/lib/catalog/types';
import { aspectValue } from '@/lib/catalog/aspect';
import {
  IMAGE_PIXEL_BUDGET,
  fitImageToBudget,
  mockImageSize,
  videoSizeFor,
  videoSizeForRatio,
} from '@/server/providers/mock/size';

describe('mockImageSize', () => {
  it('gives the documented sizes', () => {
    expect(mockImageSize('1:1')).toEqual({ width: 1024, height: 1024 });
    expect(mockImageSize('16:9')).toEqual({ width: 1280, height: 720 });
    expect(mockImageSize('9:16')).toEqual({ width: 720, height: 1280 });
    expect(mockImageSize('4:3')).toEqual({ width: 1152, height: 864 });
    expect(mockImageSize('3:4')).toEqual({ width: 864, height: 1152 });
  });

  it.each(ASPECT_RATIOS)(
    '%s has the exact ratio, multiples of 8 and about a megapixel',
    (ratio) => {
      const { width, height } = mockImageSize(ratio);
      expect(width / height).toBeCloseTo(aspectValue(ratio), 10);
      expect(width % 8).toBe(0);
      expect(height % 8).toBe(0);
      expect(width * height).toBeLessThanOrEqual(IMAGE_PIXEL_BUDGET);
      expect(width * height).toBeGreaterThan(IMAGE_PIXEL_BUDGET * 0.85);
    },
  );
});

describe('fitImageToBudget', () => {
  it('keeps small images as they are (never enlarges)', () => {
    expect(fitImageToBudget(640, 480)).toEqual({ width: 640, height: 480 });
    expect(fitImageToBudget(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('shrinks big images to about a megapixel, keeping the aspect ratio', () => {
    const { width, height } = fitImageToBudget(4096, 3072);
    expect(width * height).toBeLessThanOrEqual(IMAGE_PIXEL_BUDGET);
    expect(width * height).toBeGreaterThan(IMAGE_PIXEL_BUDGET * 0.97);
    expect(width / height).toBeCloseTo(4 / 3, 2);
  });
});

describe('video sizes', () => {
  it.each(ASPECT_RATIOS)('%s is 480 px on the longest side with even sides', (ratio) => {
    const { width, height } = videoSizeForRatio(ratio);
    expect(Math.max(width, height)).toBe(480);
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
    expect(width / height).toBeCloseTo(aspectValue(ratio), 1);
  });

  it('follows the proportions of an arbitrary picture and never collapses a side', () => {
    expect(videoSizeFor(1600, 900)).toEqual({ width: 480, height: 270 });
    expect(videoSizeFor(300, 600)).toEqual({ width: 240, height: 480 });
    expect(videoSizeFor(4000, 10).height).toBeGreaterThanOrEqual(32);
  });
});
