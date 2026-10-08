import { describe, expect, it } from 'vitest';
import { INVISIBLE_CHARS, hasVisibleText, visibleText } from '@/lib/validation/visible-text';

describe('visibleText', () => {
  it('removes invisible characters and surrounding whitespace', () => {
    expect(visibleText(' ​hello‍ \n')).toBe('hello');
    expect(visibleText('​​')).toBe('');
    expect(visibleText('\u{E0041}\u{E0042}')).toBe('');
  });

  it('keeps everything a person can see, including emoji and Arabic', () => {
    expect(visibleText('a  b')).toBe('a  b');
    expect(visibleText('قطة 🙂')).toBe('قطة 🙂');
    expect(visibleText('🙂')).toBe('🙂');
  });

  it('can be used repeatedly (the shared pattern is global)', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(visibleText('​a​')).toBe('a');
      expect(hasVisibleText('​a')).toBe(true);
    }
    expect(INVISIBLE_CHARS.flags).toContain('g');
  });
});

describe('hasVisibleText', () => {
  it.each(['', ' ', '\n\t', '​', '‌‍', '⁠', '﻿', '­', 'ㅤ'])('is false for %j', (text) => {
    expect(hasVisibleText(text)).toBe(false);
  });

  it.each(['a', '.', '0', 'ق', '🙂', ' a '])('is true for %j', (text) => {
    expect(hasVisibleText(text)).toBe(true);
  });
});
