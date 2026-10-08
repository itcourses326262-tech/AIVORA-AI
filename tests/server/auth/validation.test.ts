import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { parseLabel, parseName } from '@/server/auth/validation';

function rejection(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected a validation error');
}

describe('parseName', () => {
  it('keeps ordinary names in any script, normalised and with spaces collapsed', () => {
    expect(parseName('  Lina   Hassan ')).toBe('Lina Hassan');
    expect(parseName('محمد علي')).toBe('محمد علي');
    expect(parseName('李 小龍')).toBe('李 小龍');
    expect(parseName('Zoë')).toBe('Zoë');
    expect(parseName('😀')).toBe('😀');
    expect(parseName('-')).toBe('-');
    expect(parseName('x'.repeat(80))).toHaveLength(80);
  });

  it('keeps the joiners and direction marks that Arabic and Persian text needs', () => {
    const persian = 'می‌خواهم'; // ZWNJ inside a word
    expect(parseName(persian)).toBe(persian);
    expect(parseName('‏محمد‏')).toBe('‏محمد‏'); // RLM around text
    expect(parseName('‎Ali‎')).toBe('‎Ali‎'); // LRM around text
    expect(parseName('👩‍💻')).toBe('👩‍💻'); // ZWJ emoji sequence
  });

  it('rejects names with nothing visible in them', () => {
    const invisible: Record<string, string> = {
      'zero-width space': '​',
      'several zero-width spaces': '​​​',
      'soft hyphen': '­',
      'zero-width non-joiner': '‌',
      'zero-width joiner': '‍',
      'word joiner': '⁠',
      'byte order mark': '﻿',
      'left-to-right mark': '‎',
      'right-to-left mark': '‏',
      'arabic letter mark': '؜',
      'braille blank': '⠀',
      'hangul filler': 'ㅤ',
      'halfwidth hangul filler': 'ﾠ',
      'hangul choseong filler': 'ᅟ',
      'hangul jungseong filler': 'ᅠ',
      'fillers and spaces': ' ㅤ ⠀​ ',
      'combining mark alone': '́',
      'no-break space': ' ',
      'ideographic space': '　',
      'em space': ' ',
      'line separator': ' ',
    };
    for (const [what, value] of Object.entries(invisible)) {
      const error = rejection(() => parseName(value));
      expect(error.code, what).toBe('validation_failed');
      expect(error.details, what).toMatchObject({ issues: [{ path: 'name' }] });
    }
  });

  it('accepts hidden characters only next to visible ones', () => {
    expect(parseName('​A​')).toBe('​A​');
    expect(parseName('ㅤ B')).toBe('ㅤ B');
  });

  it('still rejects empty, too long, control and bidi-override input', () => {
    for (const value of [
      '',
      '   ',
      'x'.repeat(81),
      'a\u0000b',
      'a‮b',
      'a⁦b',
      '',
      5,
      null,
      undefined,
    ]) {
      expect(rejection(() => parseName(value)).code, String(value)).toBe('validation_failed');
    }
  });
});

describe('parseLabel', () => {
  it('applies the same visible-character rule to other labels, such as API key names', () => {
    expect(parseLabel('CI pipeline', 'name', 60)).toBe('CI pipeline');
    expect(rejection(() => parseLabel('​ㅤ', 'name', 60)).details).toMatchObject({
      issues: [{ path: 'name', message: 'Must be 1 to 60 printable characters' }],
    });
  });
});
