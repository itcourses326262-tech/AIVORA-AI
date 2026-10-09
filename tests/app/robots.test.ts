import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';

type Rule = { allow?: string | string[]; disallow?: string | string[] };

const list = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Whether a crawler may fetch `path`: the longest matching rule wins, allow wins a tie. */
function allowed(path: string): boolean {
  const rules = robots().rules;
  const rule = (Array.isArray(rules) ? rules[0] : rules) as Rule;
  const matches = (prefix: string) => path.startsWith(prefix);
  const longest = (prefixes: string[]) =>
    prefixes.filter(matches).reduce((best, prefix) => Math.max(best, prefix.length), -1);
  return longest(list(rule.allow)) >= longest(list(rule.disallow));
}

describe('robots.txt', () => {
  it('lets crawlers read the public site and keeps the logged-in pages and the API out', () => {
    for (const path of ['/', '/explore', '/s/gen_x', '/docs', '/pricing', '/login']) {
      expect(allowed(path), path).toBe(true);
    }
    for (const path of [
      '/studio',
      '/gallery',
      '/gallery/gen_x',
      '/account',
      '/api/v1/generations',
    ]) {
      expect(allowed(path), path).toBe(false);
    }
  });

  it('lets crawlers load the pictures a share page and Explore point at', () => {
    // og:image, twitter:image, JSON-LD contentUrl and the Explore thumbnails are media routes.
    expect(allowed('/api/v1/media/ast_01example')).toBe(true);
    expect(allowed('/api/v1/media/ast_01example?variant=thumb')).toBe(true);
    expect(allowed('/api/v1/explore')).toBe(false);
  });

  it('names the sitemap', () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
