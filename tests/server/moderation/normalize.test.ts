import { describe, expect, it } from 'vitest';
import {
  foldLeet,
  foldText,
  hasArabicScript,
  tokenViews,
  tokenize,
} from '@/server/moderation/normalize';

describe('foldText', () => {
  it.each([
    ['case', 'PoRn', 'porn'],
    ['fullwidth letters', 'ｐｏｒｎ', 'porn'],
    ['mathematical bold', '𝐩𝐨𝐫𝐧', 'porn'],
    ['circled letters', 'Ⓟⓞⓡⓝ', 'porn'],
    ['small capitals', 'ᴘᴏʀɴ', 'porn'],
    ['Latin accents', 'pörñ', 'porn'],
    ['Cyrillic look-alikes', 'pоrn', 'porn'],
    ['Greek look-alikes', 'ρορν', 'popv'],
    ['regional indicator letters', '🇵🇴🇷🇳', 'porn'],
    ['zero-width space', 'po​rn', 'porn'],
    ['zero-width joiner and BOM', '﻿p‍orn', 'porn'],
    ['soft hyphen', 'po­rn', 'porn'],
    ['bidi control characters', 'p‮orn', 'porn'],
    ['variation selectors', 'porn️', 'porn'],
    ['Unicode tag characters', 'p\u{E0041}orn', 'porn'],
    ['dotless i and dotted capital I', 'İı', 'ii'],
  ])('folds %s', (_label, input, expected) => {
    expect(foldText(input)).toBe(expected);
  });

  it('strips Arabic diacritics and tatweel', () => {
    expect(foldText('سِــكْــس')).toBe('سكس');
    expect(foldText('إباحيّة')).toBe('اباحيه');
  });

  it('unifies Arabic letter variants', () => {
    expect(foldText('أإآٱ')).toBe('اااا');
    expect(foldText('ى')).toBe('ي');
    expect(foldText('ة')).toBe('ه');
    expect(foldText('ؤ')).toBe('و');
  });

  it('maps Arabic-Indic digits to ASCII digits', () => {
    expect(foldText('١٢٣ ۴۵۶')).toBe('123 456');
  });

  it('leaves ordinary text alone', () => {
    expect(foldText('a red fox, 4k!')).toBe('a red fox, 4k!');
  });
});

describe('tokenize', () => {
  it('splits on anything that is not a letter or a digit', () => {
    expect(tokenize('p.o-r_n, ok! (yes)')).toEqual(['p', 'o', 'r', 'n', 'ok', 'yes']);
  });

  it('reduces runs of three or more equal characters to a double', () => {
    expect(tokenize('pooooorn heeello')).toEqual(['poorn', 'heello']);
    expect(tokenize('boobs')).toEqual(['boobs']);
  });

  it('keeps Arabic words whole', () => {
    expect(tokenize('امرأة، جميلة!')).toEqual(['امرأة', 'جميلة']);
  });
});

describe('foldLeet', () => {
  it.each([
    ['p0rn', 'porn'],
    ['s3x', 'sex'],
    ['5ex', 'sex'],
    ['@ss', 'ass'],
    ['$ex', 'sex'],
    ['h3nt41', 'hentai'],
    ['m|lf', 'milf'],
  ])('reads %s as %s', (input, expected) => {
    expect(foldLeet(input)).toBe(expected);
  });

  it('keeps digits and punctuation that touch no letter', () => {
    expect(foldLeet('4 3 1080 16:9 wow! a + b')).toBe('4 3 1080 16:9 wow! a + b');
  });
});

describe('tokenViews', () => {
  it('gives one view when leetspeak changes nothing', () => {
    expect(tokenViews('a red fox')).toEqual([['a', 'red', 'fox']]);
  });

  it('adds a leetspeak view', () => {
    expect(tokenViews('p0rn')).toEqual([['p0rn'], ['porn']]);
  });

  it('marks a stated age under 18 with a minor token in both languages', () => {
    for (const text of [
      'a 12 year old',
      'a 12-year-old',
      '12yo',
      'a 12 y.o.',
      'aged 9',
      'عمرها 10',
    ]) {
      const tokens = tokenViews(text)[0] ?? [];
      expect(tokens, text).toContain('minor');
      expect(tokens, text).toContain('قاصر');
    }
    expect(tokenViews('12 سنة')[0]).toContain('minor');
  });

  it('does not mark adults, years that are not ages, or longer numbers', () => {
    for (const text of [
      'a 30 year old',
      'a 18 year old',
      'aged 45',
      '2024 years',
      'the year 17',
      '123 years',
    ]) {
      expect(tokenViews(text)[0], text).not.toContain('minor');
    }
  });
});

describe('hasArabicScript', () => {
  it('detects Arabic letters anywhere in the text', () => {
    expect(hasArabicScript('a cat قطة')).toBe(true);
    expect(hasArabicScript('ﷲ')).toBe(true);
    expect(hasArabicScript('a cat')).toBe(false);
    expect(hasArabicScript('')).toBe(false);
  });
});
