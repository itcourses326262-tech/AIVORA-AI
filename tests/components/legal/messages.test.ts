import { describe, expect, it } from 'vitest';
import { createTranslator, type MessageKey } from '@/lib/i18n';
import type { MessageTree } from '@/lib/i18n/define';
import legal from '@/lib/i18n/messages/legal';

/**
 * The checks `tests/lib/i18n/messages.test.ts` runs for every namespace it lists, applied to the
 * `legal` namespace: identical keys, identical `{placeholders}`, no empty text, nothing left
 * untranslated.
 */

function leafEntries(tree: MessageTree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : leafEntries(value, `${prefix}${key}.`),
  );
}

const placeholdersOf = (message: string) =>
  [...message.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((match) => match[1] ?? '').sort();

const en = new Map(leafEntries(legal.en));
const ar = new Map(leafEntries(legal.ar));

describe('legal namespace', () => {
  it('has identical key sets in English and Arabic', () => {
    expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
    expect(en.size).toBeGreaterThan(100);
  });

  it('uses the same {placeholders} in English and Arabic for every key', () => {
    const problems: string[] = [];
    for (const [key, message] of en) {
      const translated = ar.get(key) ?? '';
      if (placeholdersOf(message).join() !== placeholdersOf(translated).join()) {
        problems.push(`${key}: ${placeholdersOf(message)} vs ${placeholdersOf(translated)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('has no empty text in either language', () => {
    for (const [key, message] of [...en, ...ar]) expect(message.trim(), key).not.toBe('');
  });

  it('has Arabic that differs from the English everywhere (nothing left untranslated)', () => {
    const english = createTranslator('en');
    const arabic = createTranslator('ar');
    for (const path of en.keys()) {
      const key = `legal.${path}` as MessageKey;
      expect(arabic.t(key), key).not.toBe(english.t(key));
      expect(arabic.t(key), key).toMatch(/[؀-ۿ]/);
    }
  });

  it('reaches the translator under the `legal` namespace', () => {
    expect(createTranslator('en').t('legal.terms.title')).toBe('Terms of Service');
    expect(createTranslator('ar').t('legal.terms.title')).toBe('شروط الخدمة');
    expect(createTranslator('en').t('legal.common.lastUpdated', { date: 'today' })).toBe(
      'Last updated today',
    );
  });
});
