import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  MAX_SEARCH_CHARS,
  filtersKey,
  galleryHref,
  isFiltered,
  normalizeSearch,
  parseGalleryFilters,
  toListQuery,
} from '@/components/gallery/filters';

describe('normalizeSearch', () => {
  it('trims, collapses white space and keeps the words', () => {
    expect(normalizeSearch('  lighthouse   at\n sunset  ')).toBe('lighthouse at sunset');
  });

  it('removes direction marks and zero-width spaces that pasted text brings along', () => {
    expect(normalizeSearch('\u200fغابة\u200e \u200bسحرية\ufeff')).toBe('غابة سحرية');
  });

  it('keeps the joiners that are part of the text (emoji sequences, Persian words)', () => {
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
    expect(normalizeSearch(family)).toBe(family);
    expect(normalizeSearch('می\u200cخواهم')).toBe('می\u200cخواهم');
  });

  it('puts an Arabic letter written with a combining mark into the same form as the precomposed one', () => {
    // ALEF + MADDA ABOVE versus ALEF WITH MADDA ABOVE.
    expect(normalizeSearch('ا\u0653')).toBe('آ');
  });

  it('cuts at the length the server accepts, counting characters as people do', () => {
    const long = '😀'.repeat(MAX_SEARCH_CHARS + 30);
    expect(Array.from(normalizeSearch(long))).toHaveLength(MAX_SEARCH_CHARS);
  });

  it('returns an empty string for nothing but white space', () => {
    expect(normalizeSearch(' \t\n ')).toBe('');
  });
});

describe('parseGalleryFilters', () => {
  it('reads every filter from the address', () => {
    expect(
      parseGalleryFilters({ kind: 'video', status: 'failed', favorite: '1', q: ' sunset ' }),
    ).toEqual({ kind: 'video', status: 'failed', favorite: true, q: 'sunset' });
  });

  it('falls back to the defaults for missing and unknown values instead of half-applying them', () => {
    expect(parseGalleryFilters({})).toEqual(DEFAULT_FILTERS);
    expect(
      parseGalleryFilters({ kind: 'audio', status: 'done', favorite: 'maybe', q: undefined }),
    ).toEqual(DEFAULT_FILTERS);
  });

  it('takes the first of repeated parameters', () => {
    expect(parseGalleryFilters({ kind: ['image', 'video'], q: ['a', 'b'] })).toMatchObject({
      kind: 'image',
      q: 'a',
    });
  });

  it('accepts favorite=true as well as favorite=1', () => {
    expect(parseGalleryFilters({ favorite: 'true' }).favorite).toBe(true);
    expect(parseGalleryFilters({ favorite: '0' }).favorite).toBe(false);
  });
});

describe('galleryHref and filtersKey', () => {
  it('is the bare path for the defaults', () => {
    expect(galleryHref()).toBe('/gallery');
    expect(galleryHref(DEFAULT_FILTERS)).toBe('/gallery');
  });

  it('writes only what differs, always in the same order, and encodes the search', () => {
    expect(
      galleryHref({ kind: 'image', status: 'succeeded', favorite: true, q: 'غابة & ضباب' }),
    ).toBe(
      '/gallery?kind=image&status=succeeded&favorite=1&q=%D8%BA%D8%A7%D8%A8%D8%A9+%26+%D8%B6%D8%A8%D8%A7%D8%A8',
    );
  });

  it('round-trips through parseGalleryFilters', () => {
    const filters = { kind: 'video', status: 'queued', favorite: true, q: 'a b' } as const;
    const query = Object.fromEntries(new URL(galleryHref(filters), 'http://x').searchParams);
    expect(parseGalleryFilters(query)).toEqual(filters);
  });

  it('gives equal filters equal keys and different filters different keys', () => {
    expect(filtersKey({ ...DEFAULT_FILTERS })).toBe(filtersKey(DEFAULT_FILTERS));
    expect(filtersKey({ ...DEFAULT_FILTERS, q: 'a' })).not.toBe(filtersKey(DEFAULT_FILTERS));
    expect(filtersKey({ ...DEFAULT_FILTERS, favorite: true })).not.toBe(
      filtersKey(DEFAULT_FILTERS),
    );
  });
});

describe('isFiltered', () => {
  it('is false for the defaults and true as soon as anything narrows the list', () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, kind: 'image' })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, status: 'failed' })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, favorite: true })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, q: 'x' })).toBe(true);
  });
});

describe('toListQuery', () => {
  it('leaves unset filters out of the request', () => {
    expect(toListQuery(DEFAULT_FILTERS, { limit: 24 })).toEqual({
      kind: undefined,
      status: undefined,
      favorite: undefined,
      q: undefined,
      limit: 24,
      cursor: undefined,
    });
  });

  it('sends every set filter and the cursor', () => {
    expect(
      toListQuery(
        { kind: 'video', status: 'succeeded', favorite: true, q: 'sea' },
        { limit: 24, cursor: 'abc' },
      ),
    ).toEqual({
      kind: 'video',
      status: 'succeeded',
      favorite: true,
      q: 'sea',
      limit: 24,
      cursor: 'abc',
    });
  });
});
