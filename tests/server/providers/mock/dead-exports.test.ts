import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const EXPORT_DECLARATION =
  /^export\s+(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

describe('the Demo provider module', () => {
  it('has no export that is declared and then never mentioned again anywhere in src or tests', () => {
    const owned = [
      ...filesUnder('src/server/providers/mock'),
      join(ROOT, 'src/lib/catalog/models/mock.ts'),
    ];
    const sources = [...filesUnder('src'), ...filesUnder('tests')].map((path) =>
      readFileSync(path, 'utf8'),
    );
    const mentions = (name: string) => {
      const word = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
      return sources.reduce((sum, text) => sum + (text.match(word)?.length ?? 0), 0);
    };

    const dead: string[] = [];
    for (const path of owned) {
      for (const [, name] of readFileSync(path, 'utf8').matchAll(EXPORT_DECLARATION)) {
        // One mention is the declaration itself.
        if (mentions(name!) < 2) dead.push(`${relative(ROOT, path)}: ${name}`);
      }
    }
    expect(dead).toEqual([]);
  });
});
