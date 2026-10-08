import { describe, expect, it } from 'vitest';
import { emailCopy } from '@/server/email/templates/copy';

type Tree = { readonly [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  );
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('email copy', () => {
  const en = leaves(emailCopy.en);
  const ar = leaves(emailCopy.ar);

  it('has the same keys in both languages', () => {
    expect(ar.map(([key]) => key)).toEqual(en.map(([key]) => key));
  });

  it('uses the same {placeholders} in both languages, key by key', () => {
    const arabic = new Map(ar);
    for (const [key, text] of en) {
      expect(placeholders(arabic.get(key) ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('has no empty strings and no untranslated Arabic', () => {
    const arabic = new Map(ar);
    for (const [key, text] of en) {
      expect(text.trim(), key).not.toBe('');
      expect(arabic.get(key)?.trim(), key).not.toBe('');
      if (key !== 'brand') expect(arabic.get(key), key).not.toBe(text);
    }
  });
});
