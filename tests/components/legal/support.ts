import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every `{token}` name used in a dictionary body, in order of appearance. */
export function tokensOf(source: string): string[] {
  return [...source.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '');
}

/** Every `[label](target)` target used in a dictionary body. */
export function linkTargetsOf(source: string): string[] {
  return [...source.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? '');
}

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const SRC_ROOT = join(REPO_ROOT, 'src');

/** Every `.ts` / `.tsx` file under `dir` (absolute paths, sorted). */
export function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourceFilesUnder(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) found.push(path);
  }
  return found;
}

/** A path relative to the repository root, with forward slashes, for readable assertions. */
export function repoPath(absolute: string): string {
  return relative(REPO_ROOT, absolute).split('\\').join('/');
}

export function readSource(absolute: string): string {
  return readFileSync(absolute, 'utf8');
}

/**
 * The runtime `import ... from 'x'`, `export ... from 'x'` and side-effect `import 'x'` specifiers
 * of a source file. Type-only imports are left out: they are erased and put nothing in a bundle.
 */
export function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern =
    /(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[2] === undefined && match[3] !== undefined) specifiers.push(match[3]);
  }
  return specifiers;
}

/** Resolves `@/x` and relative specifiers to a file under `src`; null for packages. */
export function resolveSpecifier(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC_ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = join(dirname(from), specifier);
  else return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}
