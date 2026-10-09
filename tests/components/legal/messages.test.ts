import { describe, expect, it } from 'vitest';
import { createTranslator, type MessageKey } from '@/lib/i18n';
import type { MessageTree } from '@/lib/i18n/define';
import legal from '@/lib/i18n/messages/legal';
import legalDocuments from '@/lib/i18n/messages/legal-documents';

/**
 * The checks `tests/lib/i18n/messages.test.ts` runs for every namespace it lists, applied to the
 * two legal dictionaries: `legal` (registered, small, used by the client) and `legal-documents`
 * (the text of the four documents, server only): identical keys, identical `{placeholders}`, no
 * empty text, nothing left untranslated.
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

describe.each([
  ['legal', legal, 20],
  ['legal-documents', legalDocuments, 100],
] as const)('%s dictionary', (_name, dictionary, minimumKeys) => {
  const en = new Map(leafEntries(dictionary.en));
  const ar = new Map(leafEntries(dictionary.ar));

  it('has identical key sets in English and Arabic', () => {
    expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
    expect(en.size).toBeGreaterThan(minimumKeys);
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
    for (const [key, english] of en) {
      const arabic = ar.get(key) ?? '';
      expect(arabic, key).not.toBe(english);
      expect(arabic, key).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('the registered legal namespace', () => {
  it('reaches the translator under `legal`', () => {
    expect(createTranslator('en').t('legal.nav.terms')).toBe('Terms of Service');
    expect(createTranslator('ar').t('legal.nav.terms')).toBe('شروط الخدمة');
    expect(createTranslator('en').t('legal.common.lastUpdated', { date: 'today' })).toBe(
      'Last updated today',
    );
  });

  it('has the six plural forms of a number of days, with {count} only where a digit is written', () => {
    for (const locale of ['en', 'ar'] as const) {
      const days = legal[locale].days;
      expect(Object.keys(days).sort()).toEqual(['few', 'many', 'one', 'other', 'two', 'zero']);
      for (const form of ['few', 'many', 'other'] as const) {
        expect(days[form], `${locale} ${form}`).toContain('{count}');
      }
      for (const form of ['zero', 'one', 'two'] as const) {
        expect(days[form], `${locale} ${form}`).not.toContain('{count}');
      }
    }
  });

  it('keeps `common`, `nav`, `footer`, `consent` and `days` reachable by their typed keys', () => {
    const keys: MessageKey[] = [
      'legal.common.eyebrow',
      'legal.common.draft.body',
      'legal.nav.acceptableUse',
      'legal.footer.title',
      'legal.consent.line',
      'legal.days.other',
    ];
    for (const key of keys) {
      expect(createTranslator('en').t(key)).not.toBe(key);
      expect(createTranslator('ar').t(key)).not.toBe(key);
    }
  });
});
