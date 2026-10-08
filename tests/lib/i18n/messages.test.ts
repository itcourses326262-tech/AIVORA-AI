import { describe, expect, it } from 'vitest';
import { ERROR_CODES, CLIENT_ERROR_CODES, GENERATION_FAILURE_CODES } from '@/lib/errors';
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

function leafEntries(tree: MessageTree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : leafEntries(value, `${prefix}${key}.`),
  );
}

/** The `{name}` placeholders of a message, sorted so repeated ones count (a multiset). */
function placeholdersOf(message: string): string[] {
  return [...message.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((match) => match[1] ?? '').sort();
}

/** Keys that exist in one language only, and keys whose `{placeholders}` differ between them. */
function parityProblems(dictionary: { en: MessageTree; ar: MessageTree }): string[] {
  const en = new Map(leafEntries(dictionary.en));
  const ar = new Map(leafEntries(dictionary.ar));
  const problems: string[] = [];
  for (const key of en.keys()) if (!ar.has(key)) problems.push(`${key}: missing in ar`);
  for (const key of ar.keys()) if (!en.has(key)) problems.push(`${key}: missing in en`);
  for (const [key, message] of en) {
    const translated = ar.get(key);
    if (translated === undefined) continue;
    const expected = placeholdersOf(message);
    const actual = placeholdersOf(translated);
    if (expected.join() !== actual.join()) {
      problems.push(`${key}: en uses {${expected.join(', ')}} but ar uses {${actual.join(', ')}}`);
    }
  }
  return problems;
}

describe('parityProblems (the checker itself)', () => {
  it('accepts matching dictionaries, whatever the order of the placeholders', () => {
    expect(
      parityProblems({
        en: { a: 'Hello {name}, {count} left', n: { b: 'x' } },
        ar: { a: '{count} متبقٍ يا {name}', n: { b: 'س' } },
      }),
    ).toEqual([]);
  });

  it('reports a surplus key that slipped past the types through a non-fresh object', () => {
    const arExtra = { x: 'أ', zzz: 'زائد' };
    // Compiles: excess-property checks only apply to fresh object literals.
    const messages = defineMessages({ en: { x: 'a' }, ar: arExtra });
    expect(parityProblems(messages)).toEqual(['zzz: missing in en']);
  });

  it('reports renamed, dropped, added and duplicated placeholders', () => {
    const problems = parityProblems({
      en: { renamed: 'Hi {name}', dropped: '{count} items', added: 'Items', twice: '{n} of {n}' },
      ar: { renamed: 'مرحبا {user}', dropped: 'عناصر', added: '{count} عناصر', twice: '{n}' },
    });
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toMatch(/renamed: en uses \{name\} but ar uses \{user\}/);
    expect(problems.join('\n')).toMatch(/dropped: en uses \{count\} but ar uses \{\}/);
    expect(problems.join('\n')).toMatch(/added: en uses \{\} but ar uses \{count\}/);
    expect(problems.join('\n')).toMatch(/twice: en uses \{n, n\} but ar uses \{n\}/);
  });
});

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

  it('uses the same {placeholders} in English and Arabic for every key', () => {
    expect(parityProblems(dictionary)).toEqual([]);
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
    for (const code of [
      ...ERROR_CODES,
      ...CLIENT_ERROR_CODES,
      ...GENERATION_FAILURE_CODES,
      'unknown',
    ] as const) {
      const key = `errors.${code}` as MessageKey;
      expect(en.t(key), key).not.toBe(key);
      expect(ar.t(key), key).not.toBe(key);
      expect(ar.t(key), key).toMatch(/[؀-ۿ]/);
    }
  });

  it('has no messages for codes that do not exist', () => {
    const known = new Set<string>([
      ...ERROR_CODES,
      ...CLIENT_ERROR_CODES,
      ...GENERATION_FAILURE_CODES,
      'unknown',
    ]);
    expect(leafPaths(errors.en).filter((path) => !known.has(path))).toEqual([]);
  });
});
