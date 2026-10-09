import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeRestore,
  forgetInSnapshot,
  neighborsOf,
  parseNavSnapshot,
  readNavSnapshot,
  saveNavSnapshot,
} from '@/components/gallery/nav-snapshot';
import { newId } from '@/lib/id';

const ids = [newId('gen'), newId('gen'), newId('gen'), newId('gen')];
const NOW = 1_800_000_000_000;

function snapshot(extra = {}) {
  return { from: '/gallery?kind=image', ids, scrollY: 640, restore: true, ...extra };
}

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the list the detail page navigates', () => {
  it('is saved and read back for the same visit', () => {
    saveNavSnapshot(snapshot(), NOW);
    expect(readNavSnapshot(NOW + 1000)).toEqual({ ...snapshot(), savedAt: NOW });
  });

  it('belongs to one visit: after two hours it is gone', () => {
    saveNavSnapshot(snapshot(), NOW);
    expect(readNavSnapshot(NOW + 2 * 60 * 60 * 1000 + 1)).toBeNull();
  });

  it('is null when nothing was saved', () => {
    expect(readNavSnapshot(NOW)).toBeNull();
  });

  it('refuses text that was not written by the gallery', () => {
    const bad: Array<string | null> = [
      null,
      'not json',
      '[]',
      '"text"',
      JSON.stringify({ from: 'https://evil.example/gallery', ids, savedAt: NOW }),
      JSON.stringify({ from: '/studio', ids, savedAt: NOW }),
      JSON.stringify({ from: '/gallery', ids: ['gen_x', 5], savedAt: NOW }),
      JSON.stringify({ from: '/gallery', ids: 'nope', savedAt: NOW }),
      JSON.stringify({ from: '/gallery', ids, savedAt: 'yesterday' }),
      JSON.stringify({ from: '/gallery', ids: Array(1001).fill(ids[0]), savedAt: NOW }),
    ];
    for (const raw of bad) expect(parseNavSnapshot(raw, NOW), String(raw)).toBeNull();
  });

  it('accepts the addresses of a filtered list and nothing that only looks like one', () => {
    for (const from of ['/gallery', '/gallery?kind=video&q=a%20b']) {
      expect(parseNavSnapshot(JSON.stringify({ from, ids, savedAt: NOW }), NOW)?.from).toBe(from);
    }
    for (const from of ['/gallery/gen_1', '/galleryx', '//gallery', '/gallery#x']) {
      expect(parseNavSnapshot(JSON.stringify({ from, ids, savedAt: NOW }), NOW), from).toBeNull();
    }
  });

  it('turns a broken scroll position into 0', () => {
    const parsed = parseNavSnapshot(
      JSON.stringify({ from: '/gallery', ids, savedAt: NOW, scrollY: -50 }),
      NOW,
    );
    expect(parsed?.scrollY).toBe(0);
    expect(
      parseNavSnapshot(JSON.stringify({ from: '/gallery', ids, savedAt: NOW, scrollY: 'x' }), NOW)
        ?.scrollY,
    ).toBe(0);
  });

  it('keeps at most 1000 ids', () => {
    const many = Array.from({ length: 1200 }, () => newId('gen'));
    saveNavSnapshot(snapshot({ ids: many }), NOW);
    expect(readNavSnapshot(NOW)?.ids).toHaveLength(1000);
  });

  it('uses the scroll position once: coming back later starts at the top', () => {
    saveNavSnapshot(snapshot(), NOW);
    consumeRestore(NOW);
    expect(readNavSnapshot(NOW)?.restore).toBe(false);
    expect(readNavSnapshot(NOW)?.ids).toEqual(ids);
  });

  it('forgets a deleted creation, so previous / next skip it', () => {
    saveNavSnapshot(snapshot(), NOW);
    forgetInSnapshot(ids[1] as string, NOW);
    expect(readNavSnapshot(NOW)?.ids).toEqual([ids[0], ids[2], ids[3]]);
    forgetInSnapshot('gen_not_in_the_list', NOW);
    expect(readNavSnapshot(NOW)?.ids).toHaveLength(3);
  });

  it('works without storage: private windows and blocked storage mean "no snapshot", never an error', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => saveNavSnapshot(snapshot(), NOW)).not.toThrow();
    expect(readNavSnapshot(NOW)).toBeNull();
    expect(() => consumeRestore(NOW)).not.toThrow();
    expect(() => forgetInSnapshot(ids[0] as string, NOW)).not.toThrow();
  });
});

describe('neighborsOf', () => {
  const saved = parseNavSnapshot(
    JSON.stringify({ from: '/gallery', ids, savedAt: NOW, scrollY: 0, restore: false }),
    NOW,
  );

  it('names the creation before and after, and the place in the list', () => {
    expect(neighborsOf(saved, ids[1] as string)).toEqual({
      previous: ids[0],
      next: ids[2],
      position: 2,
      total: 4,
    });
  });

  it('has no previous at the start and no next at the end', () => {
    expect(neighborsOf(saved, ids[0] as string)).toMatchObject({ previous: null, next: ids[1] });
    expect(neighborsOf(saved, ids[3] as string)).toMatchObject({ previous: ids[2], next: null });
  });

  it('is null when the person did not come from the list', () => {
    expect(neighborsOf(saved, newId('gen'))).toBeNull();
    expect(neighborsOf(null, ids[0] as string)).toBeNull();
  });
});
