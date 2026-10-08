import { describe, expect, it } from 'vitest';
import { ERROR_CODES, CLIENT_ERROR_CODES } from '@/lib/errors';
import { createTranslator, type MessageKey } from '@/lib/i18n';
import { defineMessages, type MessageTree } from '@/lib/i18n/define';
import account from '@/lib/i18n/messages/account';
import auth from '@/lib/i18n/messages/auth';
import common from '@/lib/i18n/messages/common';
import errors from '@/lib/i18n/messages/errors';
import gallery from '@/lib/i18n/messages/gallery';
import landing from '@/lib/i18n/messages/landing';
import studio from '@/lib/i18n/messages/studio';

const namespaces = { common, errors, auth, landing, studio, gallery, account };

function leafPaths(tree: MessageTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafPaths(value, `${prefix}${key}.`),
  );
}

describe('defineMessages', () => {
  it('returns the dictionaries unchanged', () => {
    const messages = defineMessages({
      en: { a: 'A', nested: { b: 'B' } },
      ar: { a: 'أ', nested: { b: 'ب' } },
    });
    expect(messages.en.nested.b).toBe('B');
    expect(messages.ar.nested.b).toBe('ب');
  });

  it('rejects mismatched shapes at compile time', () => {
    // @ts-expect-error `ar` is missing the key `b`
    defineMessages({ en: { a: 'A', b: 'B' }, ar: { a: 'أ' } });
    // @ts-expect-error `ar` has an extra key
    defineMessages({ en: { a: 'A' }, ar: { a: 'أ', extra: 'زائد' } });
    // @ts-expect-error `ar` nests where `en` has a string
    defineMessages({ en: { a: 'A' }, ar: { a: { deep: 'x' } } });
    // @ts-expect-error nested key missing
    defineMessages({ en: { n: { x: 'X', y: 'Y' } }, ar: { n: { x: 'س' } } });
    expect(true).toBe(true);
  });
});

describe.each(Object.entries(namespaces))('namespace %s', (name, dictionary) => {
  it('has identical key sets in English and Arabic', () => {
    expect(leafPaths(dictionary.ar).sort()).toEqual(leafPaths(dictionary.en).sort());
  });

  it('has no empty strings', () => {
    for (const language of [dictionary.en, dictionary.ar]) {
      for (const path of leafPaths(language)) {
        const value = path
          .split('.')
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], language);
        expect(String(value).trim(), path).not.toBe('');
      }
    }
  });

  it('has Arabic text that differs from the English (nothing left untranslated)', () => {
    const en = createTranslator('en');
    const ar = createTranslator('ar');
    const keys = leafPaths(dictionary.en).map((path) => `${name}.${path}`) as MessageKey[];
    for (const key of keys) {
      // The brand name and language endonyms are legitimately identical in both languages.
      if (key === 'common.app.name' || key.startsWith('common.language.')) continue;
      expect(ar.t(key), key).not.toBe(en.t(key));
    }
  });
});

describe('errors namespace', () => {
  it('has a message for every application and client error code, in both languages', () => {
    const en = createTranslator('en');
    const ar = createTranslator('ar');
    for (const code of [...ERROR_CODES, ...CLIENT_ERROR_CODES, 'unknown'] as const) {
      const key = `errors.${code}` as MessageKey;
      expect(en.t(key), key).not.toBe(key);
      expect(ar.t(key), key).not.toBe(key);
      expect(ar.t(key), key).toMatch(/[؀-ۿ]/);
    }
  });

  it('has no messages for codes that do not exist', () => {
    const known = new Set<string>([...ERROR_CODES, ...CLIENT_ERROR_CODES, 'unknown']);
    expect(leafPaths(errors.en).filter((path) => !known.has(path))).toEqual([]);
  });
});
