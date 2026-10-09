import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && /\.(tsx?|css)$/.test(candidate)) return candidate;
  }
  return null;
}

/** Every `*.module.css` that importing `entry` pulls in, however deep. */
function cssModulesReachableFrom(entry: string): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1] ?? '';
      if (specifier.endsWith('.module.css')) {
        found.add(`${file.replace(`${SRC}/`, '')} -> ${specifier}`);
        continue;
      }
      const next = resolveImport(file, specifier);
      if (next?.match(/\.tsx?$/)) visit(next);
    }
  };
  visit(entry);
  return [...found];
}

describe('the root error and not-found boundaries', () => {
  // Next preloads the stylesheets of these two boundaries on EVERY page of the app. A CSS module in
  // their tree (the landing page's mesh, say) is therefore fetched everywhere and used nowhere,
  // and the browser warns about it in the console of every page.
  for (const file of ['app/error.tsx', 'app/not-found.tsx', 'app/global-error.tsx']) {
    it(`${file} pulls in no CSS module`, () => {
      const path = join(SRC, file);
      if (!existsSync(path)) return;
      expect(cssModulesReachableFrom(path)).toEqual([]);
    });
  }

  it('the landing page still has its mesh (the check above is not vacuous)', () => {
    expect(
      cssModulesReachableFrom(join(SRC, 'components/marketing/hero.tsx')).length,
    ).toBeGreaterThan(0);
  });
});
