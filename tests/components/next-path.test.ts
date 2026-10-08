import { describe, expect, it } from 'vitest';
import { DEFAULT_NEXT_PATH, loginUrl, safeNextPath } from '@/lib/next-path';

describe('safeNextPath', () => {
  it.each(['/studio', '/gallery/gen_01hx', '/account?tab=keys', '/docs#auth', '/'])(
    'follows the local path %s',
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    ['https://evil.example/studio', 'an absolute URL'],
    ['//evil.example', 'a protocol-relative URL'],
    ['/\\evil.example', 'a backslash trick'],
    ['\\\\evil.example', 'a UNC path'],
    ['javascript:alert(1)', 'a script URL'],
    ['studio', 'a relative path'],
    ['/\t/evil.example', 'a control character inside'],
    ['', 'an empty value'],
    ['/' + 'a'.repeat(3000), 'an oversized value'],
  ])('falls back for %s (%s)', (path) => {
    expect(safeNextPath(path)).toBe(DEFAULT_NEXT_PATH);
  });

  it('keeps percent-encoded control characters: they are inert text, not a path trick', () => {
    expect(safeNextPath('/%0A')).toBe('/%0A');
  });

  it('falls back for null and undefined, and honours a custom fallback', () => {
    expect(safeNextPath(null)).toBe('/studio');
    expect(safeNextPath(undefined, '/gallery')).toBe('/gallery');
  });

  it('never sends the user back to the auth pages', () => {
    expect(safeNextPath('/login')).toBe('/studio');
    expect(safeNextPath('/login?next=/studio')).toBe('/studio');
    expect(safeNextPath('/register')).toBe('/studio');
    expect(safeNextPath('/loginhelp')).toBe('/loginhelp');
  });
});

describe('loginUrl', () => {
  it('carries the path the visitor wanted, URL-encoded', () => {
    expect(loginUrl('/gallery/gen_1?x=1&y=2')).toBe(
      '/login?next=%2Fgallery%2Fgen_1%3Fx%3D1%26y%3D2',
    );
  });

  it('leaves out an unsafe or missing path', () => {
    expect(loginUrl('//evil.example')).toBe('/login');
    expect(loginUrl(undefined)).toBe('/login');
    expect(loginUrl('/login')).toBe('/login');
  });
});
