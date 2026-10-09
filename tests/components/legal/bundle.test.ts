import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n';
import legal from '@/lib/i18n/messages/legal';
import {
  SRC_ROOT,
  importSpecifiers,
  readSource,
  repoPath,
  resolveSpecifier,
  sourceFilesUnder,
} from './support';

/**
 * The four documents are about 95 KB of text. Every registered i18n namespace is bundled into the
 * client's translator (`createTranslator`, imported by `I18nProvider`), so the text must live in a
 * module the client cannot reach. This checks that on the import graph, without a bundler.
 */

const DOCUMENTS_MODULE = 'src/lib/i18n/messages/legal-documents.ts';
const sources = sourceFilesUnder(SRC_ROOT);

const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/;
const isClientEntry = (path: string) => USE_CLIENT.test(readSource(path));

/** Every file a client entry pulls into the browser, following static imports under `src`. */
function reachableFrom(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    if (seen.has(path)) continue;
    seen.add(path);
    for (const specifier of importSpecifiers(readSource(path))) {
      const target = resolveSpecifier(specifier, path);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

describe('the text of the legal documents stays out of the client bundle', () => {
  const clientEntries = sources.filter(isClientEntry);
  const clientFiles = [...reachableFrom(clientEntries)].map(repoPath);

  it('finds the client entries and the translator they share', () => {
    expect(clientEntries.length).toBeGreaterThan(50);
    expect(clientFiles).toContain('src/lib/i18n/index.ts');
    expect(clientFiles).toContain('src/lib/i18n/messages/legal.ts');
  });

  it('is not reachable from any file that has "use client" (directly or through its imports)', () => {
    expect(clientFiles).not.toContain(DOCUMENTS_MODULE);
    expect(clientFiles.filter((file) => file.startsWith('src/components/legal/outline'))).toEqual(
      [],
    );
  });

  it('is imported by one module only, which is server code', () => {
    const importers = sources.filter((path) =>
      importSpecifiers(readSource(path)).some(
        (specifier) =>
          resolveSpecifier(specifier, path) === `${SRC_ROOT}/lib/i18n/messages/legal-documents.ts`,
      ),
    );
    expect(importers.map(repoPath)).toEqual(['src/components/legal/outline.ts']);
    expect(readSource(importers[0] ?? '')).not.toMatch(/['"]use client['"]/);
  });

  it('refuses to be imported by a client module: it imports "server-only"', () => {
    expect(readSource(`${SRC_ROOT}/lib/i18n/messages/legal-documents.ts`)).toMatch(
      /^import 'server-only';/m,
    );
  });

  it('is not part of the translator: a document key is not registered', () => {
    for (const locale of ['en', 'ar'] as const) {
      const { t } = createTranslator(locale);
      const key = 'legal.terms.sections.about.title' as Parameters<typeof t>[0];
      expect(t(key)).toBe(key);
    }
  });

  it('keeps the registered legal namespace small (labels, navigation, consent line, day counts)', () => {
    const bytes = (tree: object) => new TextEncoder().encode(JSON.stringify(tree)).length;
    expect(bytes(legal.en) + bytes(legal.ar)).toBeLessThan(8 * 1024);
    expect(Object.keys(legal.en).sort()).toEqual(['common', 'consent', 'days', 'footer', 'nav']);
  });
});
