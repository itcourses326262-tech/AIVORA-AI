import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx|ts|css)$/.test(entry) ? [path] : [];
  });
}

const PAGE_FILES = [
  ...sources(join(ROOT, 'src/components/marketing')),
  ...sources(join(ROOT, 'src/components/auth')),
  join(ROOT, 'src/app/(marketing)/page.tsx'),
  ...sources(join(ROOT, 'src/app/(auth)/login')),
  ...sources(join(ROOT, 'src/app/(auth)/register')),
  join(ROOT, 'src/app/not-found.tsx'),
  join(ROOT, 'src/app/error.tsx'),
];

// Physical directions break right-to-left layouts: margins, paddings, positions, borders, radii
// and alignment must use their logical (start/end) forms.
const PHYSICAL = [
  /(?<![\w-])-?(?:ml|mr|pl|pr)-(?:\d|\[|px|auto)/,
  /(?<![\w-])-?(?:left|right)-(?:\d|\[|px|full|1\/2)/,
  /(?<![\w-])text-(?:left|right)(?![\w-])/,
  /(?<![\w-])(?:float|clear)-(?:left|right)/,
  /(?<![\w-])(?:rounded|border)-(?:l|r|tl|tr|bl|br)(?:-|\b)/,
  /(?<![\w-])scroll-(?:ml|mr|pl|pr)-/,
  /\b(?:margin|padding)-(?:left|right)\b/,
  /(?<![\w-])(?:left|right)\s*:/,
];

describe('right-to-left safety', () => {
  it('finds the files it is meant to check', () => {
    expect(PAGE_FILES.length).toBeGreaterThan(30);
  });

  it.each(PAGE_FILES.map((file) => [relative(ROOT, file), file] as const))(
    '%s uses logical directions only',
    (_name, file) => {
      const text = readFileSync(file, 'utf8');
      const offenders = PHYSICAL.flatMap((pattern) => {
        const match = pattern.exec(text);
        return match ? [match[0]] : [];
      });
      expect(offenders).toEqual([]);
    },
  );
});
