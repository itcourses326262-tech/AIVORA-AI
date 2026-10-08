import { describe, expect, it } from 'vitest';
import { matchesIfNoneMatch } from '@/app/api/v1/media/headers';
import { decideRange } from '@/app/api/v1/media/range';

const ETAG = '"ast_x-original"';
const decide = (header: string | null, size: number, ifRange: string | null = null) =>
  decideRange(header, size, { ifRange, etag: ETAG });

describe('decideRange', () => {
  it.each([
    [null, 10, { kind: 'full' }],
    ['', 10, { kind: 'full' }],
    ['bytes=0-4', 10, { kind: 'partial', start: 0, end: 4 }],
    ['bytes=5-', 10, { kind: 'partial', start: 5, end: 9 }],
    ['bytes=-3', 10, { kind: 'partial', start: 7, end: 9 }],
    ['bytes=-30', 10, { kind: 'partial', start: 0, end: 9 }],
    ['bytes=8-100', 10, { kind: 'partial', start: 8, end: 9 }],
    ['bytes=0-0', 1, { kind: 'partial', start: 0, end: 0 }],
    ['bytes=10-', 10, { kind: 'unsatisfiable' }],
    ['bytes=0-', 0, { kind: 'unsatisfiable' }],
    ['bytes=-1', 0, { kind: 'unsatisfiable' }],
    ['bytes=-0', 10, { kind: 'unsatisfiable' }],
    ['bytes=3-2', 10, { kind: 'full' }],
    ['bytes=1-2,4-5', 10, { kind: 'full' }],
    ['pages=1-2', 10, { kind: 'full' }],
    ['bytes', 10, { kind: 'full' }],
    ['bytes=--5', 10, { kind: 'full' }],
    ['bytes=1e3-', 10, { kind: 'full' }],
    ['bytes=9007199254740993-', 10, { kind: 'unsatisfiable' }],
    ['bytes=0-9007199254740993', 10, { kind: 'partial', start: 0, end: 9 }],
  ])('%j on %i bytes', (header, size, expected) => {
    expect(decide(header, size)).toEqual(expected);
  });

  it('serves a satisfiable range only when If-Range is absent or equals our strong ETag', () => {
    expect(decide('bytes=0-1', 10, ETAG)).toMatchObject({ kind: 'partial' });
    expect(decide('bytes=0-1', 10, '"other"')).toEqual({ kind: 'full' });
    expect(decide('bytes=0-1', 10, `W/${ETAG}`)).toEqual({ kind: 'full' });
    expect(decide('bytes=0-1', 10, 'Wed, 21 Oct 2015 07:28:00 GMT')).toEqual({ kind: 'full' });
    // A stale validator also protects against 416 for a file that changed size.
    expect(decide('bytes=500-', 10, '"other"')).toEqual({ kind: 'full' });
  });
});

describe('matchesIfNoneMatch', () => {
  it('compares weakly, over lists, with the wildcard', () => {
    expect(matchesIfNoneMatch(null, ETAG)).toBe(false);
    expect(matchesIfNoneMatch(ETAG, ETAG)).toBe(true);
    expect(matchesIfNoneMatch(`W/${ETAG}`, ETAG)).toBe(true);
    expect(matchesIfNoneMatch(`"a", ${ETAG}`, ETAG)).toBe(true);
    expect(matchesIfNoneMatch('*', ETAG)).toBe(true);
    expect(matchesIfNoneMatch('"a", "b"', ETAG)).toBe(false);
    expect(matchesIfNoneMatch('', ETAG)).toBe(false);
    expect(matchesIfNoneMatch('"ast_x-thumb"', ETAG)).toBe(false);
  });
});
