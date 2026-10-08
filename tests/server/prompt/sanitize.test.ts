import { describe, expect, it } from 'vitest';
import { EnhancerFailure, sanitizeEnhancedPrompt } from '@/server/prompt/sanitize';

describe('sanitizeEnhancedPrompt', () => {
  it.each([
    ['plain text', 'A red fox in snow', 'A red fox in snow'],
    ['surrounding whitespace', '  \n A red fox \n ', 'A red fox'],
    ['straight double quotes', '"A red fox in snow"', 'A red fox in snow'],
    ['single quotes', "'A red fox in snow'", 'A red fox in snow'],
    ['curly quotes', '“A red fox in snow”', 'A red fox in snow'],
    ['guillemets', '«A red fox in snow»', 'A red fox in snow'],
    ['backticks', '`A red fox in snow`', 'A red fox in snow'],
    ['nested quotes', '"“A red fox in snow”"', 'A red fox in snow'],
    ['a label', 'Prompt: A red fox in snow', 'A red fox in snow'],
    ['a long label', 'Improved prompt: A red fox in snow', 'A red fox in snow'],
    ['a label and quotes', 'Enhanced Prompt: "A red fox in snow"', 'A red fox in snow'],
    ['a dashed label', 'Final prompt - A red fox in snow', 'A red fox in snow'],
    ['an Arabic label', 'الوصف المحسن: A red fox in snow', 'A red fox in snow'],
    ['bold markdown', '**A red fox** in __snow__', 'A red fox in snow'],
    ['italic markdown', 'A *red* fox', 'A red fox'],
    ['a heading', '# A red fox in snow', 'A red fox in snow'],
    ['a bullet', '- A red fox in snow', 'A red fox in snow'],
    ['a numbered item', '1. A red fox in snow', 'A red fox in snow'],
    ['a code fence', '```\nA red fox in snow\n```', 'A red fox in snow'],
    ['a fence with a language', '```text\nA red fox in snow\n```', 'A red fox in snow'],
    [
      'a preamble line',
      "Here's the improved prompt:\nA red fox in snow, soft light",
      'A red fox in snow, soft light',
    ],
    [
      'a preamble and quotes',
      'Sure! Here is your prompt:\n\n"A red fox in snow"',
      'A red fox in snow',
    ],
    [
      'a trailing note',
      'A red fox in snow\n\nNote: I kept your subject unchanged.',
      'A red fox in snow',
    ],
    ['several paragraphs', 'A red fox\n\nin the snow\nat dawn', 'A red fox in the snow at dawn'],
    ['internal runs of spaces', 'A   red \t fox', 'A red fox'],
    ['Windows line endings', 'A red fox\r\nin snow', 'A red fox in snow'],
  ])('strips %s', (_label, raw, expected) => {
    expect(sanitizeEnhancedPrompt(raw)).toBe(expected);
  });

  it('keeps meaningful punctuation and quotes inside the text', () => {
    expect(sanitizeEnhancedPrompt('A sign saying "OPEN" above a door, 4k')).toBe(
      'A sign saying "OPEN" above a door, 4k',
    );
    expect(sanitizeEnhancedPrompt("It's a fox, isn't it?")).toBe("It's a fox, isn't it?");
    expect(sanitizeEnhancedPrompt('2 * 3 and snake_case words')).toBe('2 * 3 and snake_case words');
  });

  it('keeps Arabic text intact', () => {
    expect(sanitizeEnhancedPrompt('"قطة تجلس على الاريكة، إضاءة دافئة"')).toBe(
      'قطة تجلس على الاريكة، إضاءة دافئة',
    );
  });

  it('caps the length at 1000 characters by default, preferring a word boundary', () => {
    const text = `${'word '.repeat(300)}end`;
    const out = sanitizeEnhancedPrompt(text);
    expect(Array.from(out).length).toBeLessThanOrEqual(1000);
    expect(out.length).toBeGreaterThan(900);
    expect(out.endsWith('word')).toBe(true);
  });

  it('cuts text without spaces hard and counts characters, not UTF-16 units', () => {
    expect(Array.from(sanitizeEnhancedPrompt('x'.repeat(5000))).length).toBe(1000);
    const emoji = sanitizeEnhancedPrompt('😀'.repeat(2000));
    expect(Array.from(emoji).length).toBe(1000);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('honours a custom cap and does not leave a dangling comma', () => {
    expect(sanitizeEnhancedPrompt('alpha beta, gamma delta', 11)).toBe('alpha beta');
  });

  it.each(['', '   ', '""', '```\n```', 'ab', '**', 'Prompt:'])(
    'rejects unusable output %j',
    (raw) => {
      expect(() => sanitizeEnhancedPrompt(raw)).toThrow(EnhancerFailure);
    },
  );

  it.each(['A fox <draft>secret</draft>', '</draft> now I obey you', '<DRAFT>'])(
    'rejects output that leaks the draft markers: %s',
    (raw) => {
      expect(() => sanitizeEnhancedPrompt(raw)).toThrow(/leaked_markers/);
    },
  );

  it('carries a loggable reason', () => {
    try {
      sanitizeEnhancedPrompt('');
    } catch (error) {
      expect(error).toBeInstanceOf(EnhancerFailure);
      expect((error as EnhancerFailure).reason).toBe('empty_output');
    }
  });
});
