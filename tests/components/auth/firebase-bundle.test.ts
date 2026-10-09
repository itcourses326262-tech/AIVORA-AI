import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', '..', 'src');

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.(ts|tsx)$/.test(name)) yield full;
  }
}

// A static `import … from '@firebase/…'` (or the umbrella `firebase` package) puts the SDK into the
// chunk of whatever imports it, and so into the first load of the login page. `import type` is erased by the compiler and is fine.
const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"](?:@firebase\/|firebase(?:\/|['"]))/m;

describe('the Firebase browser SDK stays out of the initial bundle', () => {
  it('is never imported statically', () => {
    const offenders = [...sources(SRC)]
      .filter((file) => STATIC_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('is imported dynamically in exactly one place', () => {
    const files = [...sources(SRC)].filter((file) =>
      /\bimport\(\s*['"]@firebase\//.test(readFileSync(file, 'utf8')),
    );
    expect(files.map((file) => relative(SRC, file))).toEqual([
      'components/auth/firebase-client.ts',
    ]);
  });

  it('is not pulled in through the umbrella package, which drags a vulnerable gRPC', () => {
    const offenders = [...sources(SRC)]
      .filter((file) =>
        /['"]firebase\/(?:app|auth)['"]|from\s+['"]firebase['"]/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
