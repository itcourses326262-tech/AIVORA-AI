import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n';
import type { MessageTree } from '@/lib/i18n/define';
import gallery from '@/lib/i18n/messages/gallery';
import { countForms } from '@/components/gallery/plural';

function entries(tree: MessageTree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : entries(value, `${prefix}${key}.`),
  );
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((match) => match[1]).sort();

const en = new Map(entries(gallery.en));
const ar = new Map(entries(gallery.ar));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const ROOTS = [
  'src/components/gallery',
  'src/app/explore',
  'src/app/s',
  'src/app/(app)/gallery',
].map((root) => join(process.cwd(), root));

/** Every `gallery.…` string the code mentions, whole keys and the prefixes of built ones. */
function usedKeys(): Set<string> {
  const used = new Set<string>();
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/['"`](gallery\.[A-Za-z0-9_.]+)/g)) {
        used.add(match[1] as string);
      }
    }
  }
  return used;
}

describe('gallery messages', () => {
  it('has the same keys and the same placeholders in English and Arabic', () => {
    expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, text] of en) {
      expect(placeholders(ar.get(key) ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('has no empty message', () => {
    for (const [key, text] of [...en, ...ar]) expect(text.trim(), key).not.toBe('');
  });

  it('is really translated: every Arabic message has Arabic letters', () => {
    const withoutArabic = [...ar].filter(([, text]) => !/[؀-ۿ]/.test(text));
    expect(withoutArabic.map(([key]) => key)).toEqual([]);
  });

  it('has no Arabic in a message that is English', () => {
    for (const [key, text] of en) expect(text, key).not.toMatch(/[؀-ۿ]/);
  });

  it('writes Arabic the way the app does: no ASCII digits in the sentences (numbers come from placeholders)', () => {
    for (const [key, text] of ar) expect(text.replace(/\{[^}]+\}/g, ''), key).not.toMatch(/\d/);
  });

  it('defines every key the gallery code asks for', () => {
    const used = usedKeys();
    expect(used.size).toBeGreaterThan(60);
    const missing = [...used].filter((key) => {
      const bare = key.replace(/^gallery\./, '');
      // A prefix of a built key (`gallery.list.shown`, `gallery.list.filters.kind.`).
      return !en.has(bare) && ![...en.keys()].some((candidate) => candidate.startsWith(bare));
    });
    expect(missing).toEqual([]);
  });

  it('has no message the code does not use: nothing in the dictionary is dead', () => {
    const used = usedKeys();
    const dead = [...en.keys()].filter((key) => {
      const full = `gallery.${key}`;
      return ![...used].some(
        (candidate) =>
          full === candidate || full.startsWith(`${candidate}.`) || full.startsWith(candidate),
      );
    });
    expect(dead).toEqual([]);
  });

  it('gives every counted sentence all six plural forms in both languages', () => {
    for (const message of [
      'list.shown',
      'select.count',
      'select.deleted',
      'select.favorited',
      'select.unfavorited',
    ]) {
      for (const form of ['zero', 'one', 'two', 'few', 'many', 'other']) {
        expect(en.has(`${message}.${form}`), `en ${message}.${form}`).toBe(true);
        expect(ar.has(`${message}.${form}`), `ar ${message}.${form}`).toBe(true);
      }
    }
    for (const form of ['one', 'two', 'few', 'many', 'other']) {
      expect(ar.has(`select.deleteTitle.${form}`)).toBe(true);
    }
  });
});

describe('counted sentences read right', () => {
  const ar = createTranslator('ar');
  const en = createTranslator('en');

  it('uses the Arabic number grammar: singular, dual, few, many', () => {
    const shown = (count: number) => ar.plural(count, countForms(ar.t, 'gallery.list.shown'));
    expect(shown(0)).toBe('لا توجد أعمال');
    expect(shown(1)).toBe('عرض عمل واحد');
    expect(shown(2)).toBe('عرض عملين');
    expect(shown(3)).toBe('عرض ٣ أعمال');
    expect(shown(11)).toBe('عرض ١١ عملًا');
    expect(shown(100)).toBe('عرض ١٠٠ عمل');
  });

  it('says it in English with the plain singular and plural', () => {
    const selected = (count: number) => en.plural(count, countForms(en.t, 'gallery.select.count'));
    expect(selected(0)).toBe('Nothing selected');
    expect(selected(1)).toBe('1 selected');
    expect(selected(24)).toBe('24 selected');
    const deleted = (count: number) => en.plural(count, countForms(en.t, 'gallery.select.deleted'));
    expect(deleted(1)).toBe('1 creation deleted.');
    expect(deleted(1200)).toBe('1,200 creations deleted.');
  });

  it('asks the right bulk-delete question for one, two and many creations', () => {
    const title = (t: typeof en | typeof ar, count: number) =>
      t.plural(count, {
        one: t.t('gallery.select.deleteTitle.one'),
        two: t.t('gallery.select.deleteTitle.two'),
        few: t.t('gallery.select.deleteTitle.few'),
        many: t.t('gallery.select.deleteTitle.many'),
        other: t.t('gallery.select.deleteTitle.other'),
      });
    expect(title(en, 1)).toBe('Delete this creation?');
    expect(title(en, 5)).toBe('Delete these 5 creations?');
    expect(title(ar, 1)).toBe('حذف هذا العمل؟');
    expect(title(ar, 2)).toBe('حذف هذين العملين؟');
    expect(title(ar, 7)).toBe('حذف ٧ أعمال؟');
    expect(title(ar, 15)).toBe('حذف ١٥ عملًا؟');
  });
});
