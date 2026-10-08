import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID_PREFIXES, idTimestamp, isValidId, newId, type IdPrefix } from '@/lib/id';

type IdModule = Awaited<ReturnType<typeof loadIdModule>>;

const loadIdModule = () => import('@/lib/id');

// newId keeps monotonic state per module instance; time-based tests load a pristine copy so they
// do not depend on the timestamps other tests already pushed into the shared one.
async function freshModule(): Promise<IdModule> {
  vi.resetModules();
  return loadIdModule();
}

beforeEach(() => {
  vi.resetModules();
});

describe('newId', () => {
  it('produces prefix_ + 26 lowercase base32 characters', () => {
    for (const prefix of ID_PREFIXES) {
      expect(newId(prefix)).toMatch(new RegExp(`^${prefix}_[0-9a-hjkmnp-tv-z]{26}$`));
    }
  });

  it('only emits characters allowed in storage keys', () => {
    for (let i = 0; i < 200; i++) expect(newId('gen')).toMatch(/^[a-z0-9_]+$/);
  });

  it('rejects unknown prefixes', () => {
    expect(() => newId('xyz' as IdPrefix)).toThrow(TypeError);
    expect(() => newId('' as IdPrefix)).toThrow(/Unknown id prefix/);
  });

  it('rejects timestamps that do not fit in 48 bits or are not integers', () => {
    expect(() => newId('gen', -1)).toThrow(RangeError);
    expect(() => newId('gen', 2 ** 48)).toThrow(RangeError);
    expect(() => newId('gen', 1.5)).toThrow(RangeError);
    expect(() => newId('gen', Number.NaN)).toThrow(RangeError);
  });

  it('is unique across many ids', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId('led')));
    expect(ids.size).toBe(5000);
  });

  it('sorts lexicographically in creation order, even within one millisecond', async () => {
    const { newId } = await freshModule();
    const ids = Array.from({ length: 2000 }, () => newId('gen', 1_700_000_000_000));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sorts across milliseconds', async () => {
    const { newId } = await freshModule();
    const earlier = newId('gen', 1_800_000_000_000);
    const later = newId('gen', 1_800_000_000_001);
    expect(earlier < later).toBe(true);
  });

  it('stays sortable when the clock steps backwards', async () => {
    const { newId } = await freshModule();
    const first = newId('gen', 1_900_000_000_000);
    const second = newId('gen', 1_900_000_000_000 - 5000);
    expect(first < second).toBe(true);
  });

  it('embeds the creation time', async () => {
    const { idTimestamp, newId } = await freshModule();
    const at = 1_750_000_123_456;
    expect(idTimestamp(newId('ses', at))).toBe(at);
  });

  it('borrows the next millisecond instead of wrapping when the random part overflows', async () => {
    const { idTimestamp, newId } = await freshModule();
    const original = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    // 0xff & 31 = 31: every digit is the largest one, so the second id in the same ms overflows.
    globalThis.crypto.getRandomValues = ((array: Uint8Array) => {
      array.fill(0xff);
      return array;
    }) as typeof globalThis.crypto.getRandomValues;
    try {
      const first = newId('gen', 1_600_000_000_000);
      const second = newId('gen', 1_600_000_000_000);
      expect(first < second).toBe(true);
      expect(idTimestamp(second)).toBe(1_600_000_000_001);
    } finally {
      globalThis.crypto.getRandomValues = original;
    }
  });

  it('works with only crypto.getRandomValues (browser parity)', async () => {
    const { newId } = await freshModule();
    // newId must not depend on node:crypto; assert it goes through the Web Crypto global.
    const original = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    let calls = 0;
    globalThis.crypto.getRandomValues = ((array: Uint8Array) => {
      calls += 1;
      return original(array);
    }) as typeof globalThis.crypto.getRandomValues;
    try {
      newId('key', 2_000_000_000_000);
    } finally {
      globalThis.crypto.getRandomValues = original;
    }
    expect(calls).toBe(1);
  });
});

describe('isValidId', () => {
  const good = newId('gen');

  it('accepts well-formed ids, optionally of a specific prefix', () => {
    expect(isValidId(good)).toBe(true);
    expect(isValidId(good, 'gen')).toBe(true);
    expect(isValidId(good, 'usr')).toBe(false);
  });

  it.each([
    ['not a string', 42],
    ['empty', ''],
    ['no separator', 'gen01hxyz'],
    ['unknown prefix', 'foo_00000000000000000000000000'],
    ['too short', 'gen_0000'],
    ['too long', `gen_${'0'.repeat(27)}`],
    ['uppercase', `gen_${'A'.repeat(26)}`],
    ['excluded letter u', `gen_${'u'.repeat(26)}`],
    ['excluded letter i', `gen_${'i'.repeat(26)}`],
    ['path traversal', 'gen_../../../../etc/passwd..'],
  ])('rejects %s', (_label, value) => {
    expect(isValidId(value)).toBe(false);
  });
});

describe('idTimestamp', () => {
  it('returns null for malformed ids', () => {
    expect(idTimestamp('nope')).toBeNull();
  });
});
