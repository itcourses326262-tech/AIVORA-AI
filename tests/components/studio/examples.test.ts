import { describe, expect, it } from 'vitest';
import { TOOLS } from '@/lib/catalog/types';
import { createTranslator } from '@/lib/i18n';
import {
  EXAMPLE_KEYS,
  examplesFor,
  exampleTitle,
  randomExample,
} from '@/components/studio/examples';

describe('example prompts', () => {
  it('has several in each language for every tool', () => {
    for (const tool of TOOLS) {
      const english = examplesFor(createTranslator('en').t, tool);
      const arabic = examplesFor(createTranslator('ar').t, tool);
      expect(english.length).toBeGreaterThanOrEqual(4);
      expect(arabic).toHaveLength(english.length);
      expect(new Set(english).size).toBe(english.length);
      // Not an unresolved key, and the Arabic ones are really Arabic.
      for (const text of english) expect(text).not.toMatch(/^studio\./);
      for (const text of arabic) expect(text).toMatch(/[؀-ۿ]/);
    }
    expect(Object.keys(EXAMPLE_KEYS).sort()).toEqual([...TOOLS].sort());
  });

  it('fits every example inside the shortest prompt limit of the catalog models', () => {
    for (const tool of TOOLS) {
      for (const locale of ['en', 'ar'] as const) {
        for (const text of examplesFor(createTranslator(locale).t, tool)) {
          expect(Array.from(text).length).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  it('names a chip by the words before the first comma, Latin or Arabic', () => {
    expect(exampleTitle('A lone lighthouse on a cliff, dramatic clouds')).toBe(
      'A lone lighthouse on a cliff',
    );
    expect(exampleTitle('منارة وحيدة على جرف، غيوم درامية')).toBe('منارة وحيدة على جرف');
    expect(exampleTitle('No comma here')).toBe('No comma here');
  });

  it('"Surprise me" never repeats the text that is already there', () => {
    const examples = ['one', 'two', 'three'];
    for (let i = 0; i < 30; i += 1) {
      expect(randomExample(examples, 'two')).not.toBe('two');
    }
    expect(randomExample(examples, '  one  ', () => 0)).toBe('two');
    expect(randomExample(examples, '', () => 0.99)).toBe('three');
    expect(randomExample([], '')).toBeUndefined();
    expect(randomExample(['only'], 'only')).toBeUndefined();
  });
});
