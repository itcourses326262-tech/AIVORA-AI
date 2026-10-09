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

const FILES = [
  ...sources(join(ROOT, 'src/components/gallery')),
  ...sources(join(ROOT, 'src/app/explore')),
  ...sources(join(ROOT, 'src/app/s')),
  ...sources(join(ROOT, 'src/app/(app)/gallery')),
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

describe('right-to-left safety of the gallery, Explore and the share page', () => {
  it('finds the files it is meant to check', () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  it.each(FILES.map((file) => [relative(ROOT, file), file] as const))(
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
