import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// GitHub push protection rejects pushes that contain key-shaped strings, including obviously fake ones
// in test fixtures. Build such fixtures at runtime instead (e.g. 'sk_test_' + 'abc123...').
const KEY_SHAPES: Array<[string, RegExp]> = [
  [
    'payment/API secret key (sk_/pk_/rk_ live|test)',
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/,
  ],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['fal key', /\bfal_sk_[A-Za-z0-9]{8,}/],
];

const ROOT = join(__dirname, '..', '..');
const SCAN = ['src', 'tests', 'scripts', 'e2e', 'docs'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'coverage',
  'test-results',
  'playwright-report',
]);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|mdx|css|yml|yaml|env|example|txt|sh)$/;

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) yield* walk(full);
    else if (TEXT.test(name) && info.size < 2_000_000) yield full;
  }
}

describe('repository hygiene', () => {
  it('contains no key-shaped secret literals', () => {
    const hits: string[] = [];
    for (const dir of SCAN) {
      for (const file of walk(join(ROOT, dir))) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          for (const [label, shape] of KEY_SHAPES) {
            if (shape.test(line)) hits.push(`${relative(ROOT, file)}:${index + 1} (${label})`);
          }
        });
      }
    }
    expect(hits, 'build fixtures at runtime, never commit key-shaped literals').toEqual([]);
  });
});
