import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n';
import type { MessageTree } from '@/lib/i18n/define';
import studio from '@/lib/i18n/messages/studio';
import { MODEL_BADGES } from '@/lib/catalog/types';
import { GENERATION_STATUSES } from '@/lib/api-types';

function entries(tree: MessageTree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : entries(value, `${prefix}${key}.`),
  );
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((match) => match[1]).sort();

const en = new Map(entries(studio.en));
const ar = new Map(entries(studio.ar));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('studio messages', () => {
  it('has the same keys and the same placeholders in English and Arabic', () => {
    expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, text] of en) {
      expect(placeholders(ar.get(key) ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('has no empty message', () => {
    for (const [key, text] of [...en, ...ar]) expect(text.trim(), key).not.toBe('');
  });

  it('is really translated: every Arabic message has Arabic letters, apart from the few that are only names or formats', () => {
    // A format with nothing to translate.
    const allowed = new Set(['generations.card.label']);
    const withoutArabic = [...ar]
      .filter(([, text]) => !/[؀-ۿ]/.test(text))
      .map(([key]) => key)
      .filter((key) => !allowed.has(key));
    expect(withoutArabic).toEqual([]);
  });

  it('has no English left in a message that is Arabic and no Arabic in one that is English', () => {
    for (const [key, text] of en) {
      expect(text, key).not.toMatch(/[؀-ۿ]/);
    }
  });

  it('writes Arabic the way the app does: no ASCII digits in the sentences (numbers come from placeholders)', () => {
    for (const [key, text] of ar) {
      expect(text.replace(/\{[^}]+\}/g, ''), key).not.toMatch(/\d/);
    }
  });

  it('defines every key the studio code asks for', () => {
    const roots = ['src/components/studio', 'src/components/generations', 'src/lib/generations'];
    const used = new Set<string>();
    for (const root of roots) {
      for (const file of sourceFiles(join(process.cwd(), root))) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/['"`](studio\.[A-Za-z0-9_.]+)['"`]/g)) {
          used.add((match[1] as string).replace(/^studio\./, ''));
        }
      }
    }
    expect(used.size).toBeGreaterThan(80);
    const missing = [...used].filter((key) => !en.has(key));
    expect(missing).toEqual([]);
  });

  it('defines the keys that are built from a value: statuses, kinds, badges, failure codes, tools', () => {
    for (const status of GENERATION_STATUSES)
      expect(en.has(`generations.status.${status}`)).toBe(true);
    for (const kind of ['image', 'video']) expect(en.has(`generations.kind.${kind}`)).toBe(true);
    for (const badge of MODEL_BADGES) expect(en.has(`model.badge.${badge}`)).toBe(true);
    for (const code of [
      'content_policy',
      'invalid_input',
      'rate_limited',
      'unavailable',
      'timeout',
      'internal',
      'unknown',
    ]) {
      expect(en.has(`generations.failure.${code}`)).toBe(true);
    }
  });

  it('has every message unused by the code removed: nothing in the dictionary is dead', () => {
    const roots = ['src/components/studio', 'src/components/generations', 'src/lib/generations'];
    let source = '';
    for (const root of roots) {
      for (const file of sourceFiles(join(process.cwd(), root)))
        source += readFileSync(file, 'utf8');
    }
    const dynamicPrefixes = [
      'generations.status.',
      'generations.kind.',
      'model.badge.',
      'generations.failure.',
      'examples.',
      'prompt.placeholder.',
      'units.images.',
      'generations.credits.',
      'generations.media.',
    ];
    const dead = [...en.keys()].filter(
      (key) =>
        !dynamicPrefixes.some((prefix) => key.startsWith(prefix)) &&
        !source.includes(`studio.${key}`) &&
        !source.includes(`'${key}'`),
    );
    expect(dead).toEqual([]);
  });

  it('formats the credit and image plurals with the grammar of each language', () => {
    const t = createTranslator('en');
    const a = createTranslator('ar');
    expect(t.plural(1, { one: t.t('studio.generations.credits.one'), other: 'x' })).toBe(
      '1 credit',
    );
    expect(a.plural(2, { two: a.t('studio.generations.credits.two'), other: 'x' })).toBe('رصيدان');
  });
});
