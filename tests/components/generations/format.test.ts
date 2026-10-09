import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n';
import {
  charCount,
  clipText,
  creditsText,
  formatElapsed,
  imagesText,
  isolateLtr,
  needsDemoBadge,
} from '@/lib/generations/format';

describe('formatElapsed', () => {
  it('reads minutes and seconds with a padded seconds field', () => {
    expect(formatElapsed(0, 'en')).toBe('0:00');
    expect(formatElapsed(7_400, 'en')).toBe('0:07');
    expect(formatElapsed(155_000, 'en')).toBe('2:35');
  });

  it('adds hours past sixty minutes', () => {
    expect(formatElapsed(3_723_000, 'en')).toBe('1:02:03');
  });

  it('uses the digits of the locale', () => {
    expect(formatElapsed(155_000, 'ar')).toBe('٢:٣٥');
    expect(formatElapsed(0, 'ar')).toBe('٠:٠٠');
  });

  it('treats a negative or broken duration as zero (a client clock behind the server)', () => {
    expect(formatElapsed(-5_000, 'en')).toBe('0:00');
    expect(formatElapsed(Number.NaN, 'en')).toBe('0:00');
    expect(formatElapsed(Number.POSITIVE_INFINITY, 'en')).toBe('0:00');
  });
});

describe('creditsText and imagesText', () => {
  const en = createTranslator('en');
  const ar = createTranslator('ar');

  it('follows English grammar', () => {
    expect(creditsText(en, 1)).toBe('1 credit');
    expect(creditsText(en, 6)).toBe('6 credits');
    expect(imagesText(en, 1)).toBe('1 image');
    expect(imagesText(en, 4)).toBe('4 images');
  });

  it('follows Arabic grammar for one, two, a few, many and the rest', () => {
    expect(creditsText(ar, 1)).toBe('رصيد واحد');
    expect(creditsText(ar, 2)).toBe('رصيدان');
    expect(creditsText(ar, 6)).toBe('٦ أرصدة');
    expect(creditsText(ar, 38)).toBe('٣٨ رصيدًا');
    expect(creditsText(ar, 100)).toBe('١٠٠ رصيد');
    expect(imagesText(ar, 2)).toBe('صورتان');
    expect(imagesText(ar, 3)).toBe('٣ صور');
  });
});

describe('clipText', () => {
  it('flattens whitespace and leaves a short text alone', () => {
    expect(clipText('  a\n  quiet   beach ', 80)).toBe('a quiet beach');
  });

  it('cuts at a word boundary and adds an ellipsis', () => {
    const text = 'a lone lighthouse on a cliff at sunset with dramatic clouds';
    const clipped = clipText(text, 30);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(31);
    expect(text.startsWith(clipped.slice(0, -1))).toBe(true);
    expect(clipped).not.toMatch(/\s…$/);
  });

  it('never splits an emoji in half', () => {
    expect(clipText('😀'.repeat(10), 4)).toBe(`${'😀'.repeat(4)}…`);
  });
});

describe('charCount and isolateLtr', () => {
  it('counts what a person counts, like the server does', () => {
    expect(charCount('abc')).toBe(3);
    expect(charCount('😀😀')).toBe(2);
    expect(charCount('')).toBe(0);
  });

  it('wraps a token in left-to-right isolates', () => {
    expect(isolateLtr('0:07')).toBe('⁦0:07⁩');
  });
});

describe('needsDemoBadge', () => {
  it('tags a sample model, unless its name already says so', () => {
    expect(needsDemoBadge('Sample Image', true)).toBe(true);
    expect(needsDemoBadge(undefined, true)).toBe(true);
    expect(needsDemoBadge('AIVORE Demo Image', true)).toBe(false);
    expect(needsDemoBadge('aivore demo video', true)).toBe(false);
    expect(needsDemoBadge('FLUX.1 Schnell', false)).toBe(false);
  });
});
