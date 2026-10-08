import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REASON_KEYS } from '@/components/account/ledger';
import { ACCOUNT_TABS } from '@/components/account/tabs';
import { QUICKSTART_STEPS } from '@/components/docs/snippets';
import type { MessageTree } from '@/lib/i18n/define';
import account from '@/lib/i18n/messages/account';

function entries(tree: MessageTree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : entries(value, `${prefix}${key}.`),
  );
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((match) => match[1]).sort();

const en = new Map(entries(account.en));
const ar = new Map(entries(account.ar));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const ROOTS = [
  'src/components/account',
  'src/components/docs',
  'src/app/docs',
  'src/app/(app)/account',
].map((root) => join(process.cwd(), root));
const source = ROOTS.flatMap(sourceFiles)
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

/** Keys written out in full, and keys with a `${value}` in them, as patterns. */
const literalKeys = new Set(
  [...source.matchAll(/['"`](account\.[A-Za-z0-9_.]+)['"`]/g)].map((match) => match[1] as string),
);
const templateKeys = [...source.matchAll(/`(account\.[A-Za-z0-9_.]*\$\{[^`]*)`/g)].map(
  (match) => match[1] as string,
);
const templatePatterns = templateKeys.map(
  (template) =>
    new RegExp(
      `^${template
        .split(/\$\{[^}]*\}/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[A-Za-z0-9_]+')}$`,
    ),
);
const withPrefix = (key: string) => key.replace(/^account\./, '');

describe('account messages', () => {
  it('has the same keys and the same placeholders in English and Arabic', () => {
    expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, text] of en) {
      expect(placeholders(ar.get(key) ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('has no empty message, also not in the documentation', () => {
    for (const [key, text] of [...en, ...ar]) expect(text.trim(), key).not.toBe('');
    const docs = [...en.keys()].filter((key) => key.startsWith('docs.'));
    expect(docs.length).toBeGreaterThan(100);
  });

  it('is really translated: every Arabic message has Arabic letters, apart from names and formats', () => {
    const withoutArabic = [...ar]
      .filter(([, text]) => !/[؀-ۿ]/.test(text.replace(/\{[^}]+\}/g, '')))
      .map(([key]) => key);
    expect(withoutArabic).toEqual([]);
  });

  it('has no Arabic in an English message', () => {
    for (const [key, text] of en) expect(text, key).not.toMatch(/[؀-ۿ]/);
  });

  it('keeps digits out of Arabic sentences: numbers come in through placeholders', () => {
    // The documentation quotes values of the API (limits, versions, status codes) the way the code
    // writes them, in ASCII digits. Everything else is a sentence of the interface.
    for (const [key, text] of ar) {
      const sentence = text.replace(/\{[^}]+\}/g, '').replace(/`[^`]*`/g, '');
      if (key.startsWith('docs.')) expect(text, key).not.toMatch(/[٠-٩]/);
      else expect(sentence, key).not.toMatch(/\d/);
    }
  });

  it('defines every key the account and documentation code asks for', () => {
    expect(literalKeys.size).toBeGreaterThan(150);
    const missing = [...literalKeys].filter((key) => !en.has(withPrefix(key)));
    expect(missing).toEqual([]);
  });

  it('has something behind every key built from a value, so none can be a typo', () => {
    expect(templatePatterns.length).toBeGreaterThan(3);
    for (const [index, pattern] of templatePatterns.entries()) {
      const matches = [...en.keys()].filter((key) => pattern.test(`account.${key}`));
      expect(matches.length, templateKeys[index]).toBeGreaterThan(0);
    }
  });

  it('defines the keys that depend on a value: tabs, ledger reasons, quickstart steps', () => {
    for (const tab of ACCOUNT_TABS) expect(en.has(`tabs.${tab}`), tab).toBe(true);
    for (const key of Object.values(REASON_KEYS)) expect(en.has(withPrefix(key)), key).toBe(true);
    for (const step of QUICKSTART_STEPS) {
      expect(en.has(`docs.quickstart.steps.${step}.title`), step).toBe(true);
      expect(en.has(`docs.quickstart.steps.${step}.body`), step).toBe(true);
    }
    for (const access of ['public', 'optional', 'any', 'session']) {
      expect(en.has(`docs.reference.access.${access}`), access).toBe(true);
    }
    for (const location of ['path', 'query', 'header']) {
      expect(en.has(`docs.reference.parameters.${location}`), location).toBe(true);
    }
  });

  it('leaves no message unused: nothing in the dictionary is dead', () => {
    const dead = [...en.keys()].filter((key) => {
      const full = `account.${key}`;
      return !literalKeys.has(full) && !templatePatterns.some((pattern) => pattern.test(full));
    });
    expect(dead).toEqual([]);
  });
});
