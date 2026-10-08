import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clamp,
  cn,
  decodeCursor,
  encodeCursor,
  formatBytes,
  formatCredits,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPlainNumber,
  formatRelativeTime,
  formatSeconds,
  intlTag,
  isRecord,
  safeJson,
  sleep,
} from '@/lib/utils';

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
    expect(cn({ on: true, off: false }, ['x', 'y'])).toBe('on x y');
  });

  it('lets the last conflicting Tailwind utility win', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    expect(cn('text-sm', 'text-lg')).toBe('text-lg');
  });
});

describe('clamp', () => {
  it('limits to the range', () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-5, 1, 3)).toBe(1);
    expect(clamp(2, 1, 3)).toBe(2);
  });

  it('rejects an inverted range', () => {
    expect(() => clamp(1, 3, 1)).toThrow(RangeError);
  });

  it('maps NaN to the minimum instead of propagating it', () => {
    expect(clamp(Number.NaN, 1, 100)).toBe(1);
    expect(clamp(Number.NaN, -5, 5)).toBe(-5);
  });

  it('pins infinities to the ends of the range', () => {
    expect(clamp(Infinity, 1, 100)).toBe(100);
    expect(clamp(-Infinity, 1, 100)).toBe(1);
  });
});

describe('sleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    let done = false;
    const pending = sleep(1000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(sleep(10_000, controller.signal)).rejects.toThrow('stop');
  });

  it('rejects when aborted while waiting and clears its timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    const assertion = expect(pending).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled'));
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('safeJson / isRecord', () => {
  it('parses valid JSON and returns undefined for invalid input', () => {
    expect(safeJson('{"a":1}')).toEqual({ a: 1 });
    expect(safeJson('null')).toBeNull();
    expect(safeJson('{oops')).toBeUndefined();
    expect(safeJson('')).toBeUndefined();
  });

  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});

describe('Intl formatters', () => {
  it('uses stable locale tags', () => {
    expect(intlTag('ar')).toBe('ar-EG');
    expect(intlTag('en')).toBe('en-US');
  });

  it('formats numbers with the locale numerals and grouping', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'ar')).toBe('١٬٢٣٤٫٥');
    expect(formatCredits(1234.6, 'en')).toBe('1,235');
    expect(formatCredits(50, 'ar')).toBe('٥٠');
  });

  it('formatPlainNumber never groups, so years and ids stay readable', () => {
    expect(formatPlainNumber(2026, 'en')).toBe('2026');
    expect(formatPlainNumber(2026, 'ar')).toBe('٢٠٢٦');
    expect(formatPlainNumber(1234567, 'en')).toBe('1234567');
  });

  it('formats dates in a requested time zone', () => {
    const ts = Date.UTC(2026, 0, 15, 18, 30);
    expect(formatDate(ts, 'en', 'medium', 'UTC')).toBe('Jan 15, 2026');
    expect(formatDate(ts, 'ar', 'medium', 'UTC')).toContain('٢٠٢٦');
    expect(formatDateTime(ts, 'en', 'UTC')).toMatch(/Jan 15, 2026.*6:30\s?PM/);
    // Gregorian even for Arabic (ar-SA would default to the Islamic calendar).
    expect(formatDate(ts, 'ar', 'long', 'UTC')).toContain('يناير');
  });

  it('formats relative time with the right unit', () => {
    const now = Date.UTC(2026, 5, 1, 12, 0, 0);
    expect(formatRelativeTime(now - 30_000, 'en', now)).toBe('now');
    expect(formatRelativeTime(now - 3 * 60_000, 'en', now)).toBe('3 minutes ago');
    expect(formatRelativeTime(now - 2 * 3_600_000, 'en', now)).toBe('2 hours ago');
    expect(formatRelativeTime(now - 24 * 3_600_000, 'en', now)).toBe('yesterday');
    expect(formatRelativeTime(now + 5 * 60_000, 'en', now)).toBe('in 5 minutes');
    expect(formatRelativeTime(now - 3 * 60_000, 'ar', now)).toContain('٣');
  });

  it('formats byte sizes with the right unit', () => {
    expect(formatBytes(0, 'en')).toBe('0 byte');
    expect(formatBytes(1536, 'en')).toBe('1.5 kB');
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5 MB');
    expect(formatBytes(-10, 'en')).toBe('0 byte');
    expect(formatBytes(3 * 1024 ** 4, 'en')).toBe('3,072 GB');
  });

  it('formats seconds', () => {
    expect(formatSeconds(5, 'en')).toBe('5 sec');
    expect(formatSeconds(2.5, 'en')).toBe('2.5 sec');
    expect(formatSeconds(5, 'ar')).toContain('٥');
  });
});

describe('cursors', () => {
  it('round-trips strings and numbers through a URL-safe token', () => {
    const cursor = encodeCursor([1_760_000_000_123, 'led_01hxyzabcdefghjkmnpqrstvwx']);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual([1_760_000_000_123, 'led_01hxyzabcdefghjkmnpqrstvwx']);
  });

  it('round-trips non-ASCII text', () => {
    expect(decodeCursor(encodeCursor(['مرحبا ✓']))).toEqual(['مرحبا ✓']);
  });

  it('returns null for anything that is not a cursor', () => {
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not base64 !!')).toBeNull();
    expect(decodeCursor('bm90LWpzb24')).toBeNull(); // "not-json"
    expect(decodeCursor(encodeCursor([1]).slice(0, -2) + '$$')).toBeNull();
    expect(decodeCursor('A'.repeat(600))).toBeNull();
    // Valid JSON but not an array of strings/numbers.
    const objectCursor = btoa('{"a":1}').replace(/=+$/, '');
    expect(decodeCursor(objectCursor)).toBeNull();
    const nestedCursor = btoa('[[1]]').replace(/=+$/, '');
    expect(decodeCursor(nestedCursor)).toBeNull();
  });
});
