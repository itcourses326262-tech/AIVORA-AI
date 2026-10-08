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

  it.each([
    'thirteen year old',
    'a twelve-year-old',
    'seventeen year old',
    'ten yo',
    'one year old',
    'a 9 yrs old',
    '12 years old',
    '12 years of age',
    'a 10 years girl',
    '6 months old',
    'age of fifteen',
    'age: 15',
    'aged fourteen',
    'she is 13',
    "she's 14",
    "I'm 15",
    'a girl who is fourteen',
    'the boy turned ten',
    'under 18',
    'younger than eighteen',
    'ثلاث سنوات',
    'اربعة عشر عاما',
    'احدى عشرة سنة',
    'عمرها اربعة عشر',
    'عمرها ثلاث سنوات',
    'بعمر 12',
    '12 سنة من العمر',
    'اقل من 18',
  ])('reads "%s" as a minor', (text) => {
    expect(tokenViews(text)[0], text).toContain('minor');
  });

  it('reads an age spelled in leetspeak once the digits are letters', () => {
    expect(tokenViews('th1rteen year old').some((view) => view.includes('minor'))).toBe(true);
  });

  it('does not mark adults, years that are not ages, or longer numbers', () => {
    for (const text of [
      'a 30 year old',
      'a 18 year old',
      'aged 45',
      '2024 years',
      'the year 17',
      '123 years',
      'eighteen year old',
      'nineteen year old',
      'twenty-one year old',
      'thirty five years old',
      'one hundred and two years old',
      'she is 25',
      'she is 5 feet tall',
      'it is 5 pm',
      'under 18 dollars',
      'a vampire 400 years old',
      'عمرها 30',
      'ثمانية عشر عاما',
      'عمرها ثمانية عشر',
    ]) {
      expect(tokenViews(text)[0], text).not.toContain('minor');
    }
  });

  it('reads long runs of spaces, punctuation, digits and number words in linear time', () => {
    const shapes = [
      `a${' '.repeat(100_000)}`,
      `a${'!'.repeat(100_000)}`,
      `${' '.repeat(100_000)}one year old`,
      `${' '.repeat(100_000)}12 سنة`,
      '1 '.repeat(50_000),
      'one '.repeat(25_000),
      'twenty '.repeat(15_000),
      'she is '.repeat(15_000),
      'عشر '.repeat(25_000),
      `عشر${' '.repeat(100_000)}سنوات`,
    ];
    for (const text of shapes) {
      const started = performance.now();
      tokenViews(text);
      expect(performance.now() - started, text.slice(0, 20)).toBeLessThan(500);
    }
  });

  it('does not take a plain number of years for an age', () => {
    for (const text of [
      '5 years later',
      '10 years of marriage',
      '3 years ago',
      'after 15 years',
      '15 years',
      '10 yrs',
      'بعد عشر سنوات',
      '10 سنوات من الزواج',
      'مضت 5 سنوات',
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
