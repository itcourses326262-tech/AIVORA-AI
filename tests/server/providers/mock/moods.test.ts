import { describe, expect, it } from 'vitest';
import { createPalette, oklch } from '@/server/providers/mock/color';
import { detectMood } from '@/server/providers/mock/moods';
import { createRng } from '@/server/providers/mock/random';

describe('detectMood', () => {
  it('finds English keywords, including plurals, as whole words', () => {
    expect(detectMood('A quiet sunset over the sea')?.hue).toBeDefined();
    expect(detectMood('stars and moons')?.styles).toContain('orbit');
    expect(detectMood('winter snow')?.dark).toBe(false);
  });

  it('does not fire on words that merely contain a keyword', () => {
    expect(detectMood('a nice office with a thousand glasses')).toBeUndefined();
    expect(detectMood('')).toBeUndefined();
  });

  it('finds Arabic keywords with a definite article or vowel marks', () => {
    expect(detectMood('غروب الشمس')?.hue).toBe(detectMood('sunset')?.hue);
    expect(detectMood('البحر الهادئ')?.hue).toBe(detectMood('ocean')?.hue);
    expect(detectMood('غُروب')?.hue).toBe(detectMood('sunset')?.hue);
    expect(detectMood('غابة خضراء')?.hue).toBe(detectMood('forest')?.hue);
  });

  it('picks the mood with the most hits', () => {
    expect(detectMood('forest tree garden at sunset')?.hue).toBe(detectMood('forest')?.hue);
  });
});

describe('palettes', () => {
  it('is reproducible for the same random stream and mood', () => {
    expect(createPalette(createRng(4))).toEqual(createPalette(createRng(4)));
    expect(createPalette(createRng(4))).not.toEqual(createPalette(createRng(5)));
  });

  it('only produces valid sRGB channels, dark and light', () => {
    for (let seed = 0; seed < 60; seed++) {
      const palette = createPalette(createRng(seed), seed % 2 ? detectMood('desert') : undefined);
      for (const colour of [...palette.ramp, palette.accent, palette.glow, palette.ink]) {
        for (const channel of colour) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
      const luma = (c: number[]) => c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
      expect(luma(palette.ramp[0])).toBeLessThan(luma(palette.ramp[4]));
    }
  });

  it('reduces chroma instead of clipping the hue when a colour is out of gamut', () => {
    const [r, g, b] = oklch(0.5, 0.4, 145);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThan(r);
  });
});
