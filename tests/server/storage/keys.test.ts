import { describe, expect, it } from 'vitest';
import { assertStorageKey, isValidStorageKey } from '@/server/storage/keys';
import { resolveStorageRange } from '@/server/storage/range';
import { RangeNotSatisfiableError } from '@/server/storage/types';
import { objectKeys } from '@/server/uploads/keys';

describe('isValidStorageKey', () => {
  it('accepts the documented layouts', () => {
    expect(isValidStorageKey('u/usr_01hx/gen_01hx/ast_01hx.png')).toBe(true);
    expect(isValidStorageKey('u/usr_01hx/uploads/ast_01hx.thumb.webp')).toBe(true);
    expect(isValidStorageKey('a')).toBe(true);
  });

  it.each([
    '',
    '/a',
    'a/',
    'a//b',
    '.',
    '..',
    'a/..',
    'a/../b',
    './a',
    'a/.b',
    'A',
    'a b',
    'a\\b',
    'a\0',
    'é',
  ])('refuses %j', (key) => {
    expect(isValidStorageKey(key)).toBe(false);
    expect(() => assertStorageKey(key)).toThrow('Invalid storage key');
  });

  it('bounds the length of keys and segments', () => {
    expect(isValidStorageKey('a'.repeat(200))).toBe(true);
    expect(isValidStorageKey('a'.repeat(201))).toBe(false);
    expect(isValidStorageKey(`${'a/'.repeat(255)}a`)).toBe(true);
    expect(isValidStorageKey(`${'a/'.repeat(256)}a`)).toBe(false);
  });
});

describe('objectKeys', () => {
  it('builds the section 6.5 layout', () => {
    expect(
      objectKeys({ userId: 'usr_a', folder: 'gen_b', assetId: 'ast_c', extension: 'mp4' }),
    ).toEqual({
      storageKey: 'u/usr_a/gen_b/ast_c.mp4',
      thumbKey: 'u/usr_a/gen_b/ast_c.thumb.webp',
    });
  });

  it('refuses parts that could change the shape of the key', () => {
    for (const bad of ['', '..', 'a/b', 'A', '-x', '.x', 'a b', 'x'.repeat(129)]) {
      expect(() =>
        objectKeys({ userId: bad, folder: 'g', assetId: 'a', extension: 'png' }),
      ).toThrow();
      expect(() =>
        objectKeys({ userId: 'u', folder: bad, assetId: 'a', extension: 'png' }),
      ).toThrow();
      expect(() =>
        objectKeys({ userId: 'u', folder: 'g', assetId: bad, extension: 'png' }),
      ).toThrow();
    }
    for (const bad of ['', '.png', 'p/g', 'PNG', 'toolongext1']) {
      expect(() =>
        objectKeys({ userId: 'u', folder: 'g', assetId: 'a', extension: bad }),
      ).toThrow();
    }
  });
});

describe('resolveStorageRange', () => {
  it('resolves open, closed, clamped and suffix ranges', () => {
    expect(resolveStorageRange({ start: 2, end: 4 }, 10)).toEqual({ start: 2, end: 4 });
    expect(resolveStorageRange({ start: 2 }, 10)).toEqual({ start: 2, end: 9 });
    expect(resolveStorageRange({ start: 2, end: 99 }, 10)).toEqual({ start: 2, end: 9 });
    expect(resolveStorageRange({ start: -4 }, 10)).toEqual({ start: 6, end: 9 });
    expect(resolveStorageRange({ start: -40 }, 10)).toEqual({ start: 0, end: 9 });
  });

  it('refuses ranges that select no byte, carrying the size', () => {
    for (const range of [
      { start: 10 },
      { start: 3, end: 2 },
      { start: -2, end: 5 },
      { start: Number.NaN },
    ]) {
      try {
        resolveStorageRange(range, 10);
        throw new Error('expected a RangeNotSatisfiableError');
      } catch (error) {
        expect(error).toBeInstanceOf(RangeNotSatisfiableError);
        expect((error as RangeNotSatisfiableError).size).toBe(10);
      }
    }
    expect(() => resolveStorageRange({ start: -1 }, 0)).toThrow(RangeNotSatisfiableError);
  });
});
