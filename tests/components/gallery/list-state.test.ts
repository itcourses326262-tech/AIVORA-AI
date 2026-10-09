import { describe, expect, it } from 'vitest';
import { initialListState, listReducer, type ListState } from '@/components/gallery/list-state';
import { generationDTO } from '../generations/support';

const g = (id: string, extra = {}) => generationDTO({ id: `gen_${id.padEnd(26, '0')}`, ...extra });
const [a, b, c, d] = [g('a'), g('b'), g('c'), g('d')];

function ready(key = 'k', items = [a, b], cursor: string | null = 'next'): ListState {
  return listReducer(initialListState(key), { type: 'loaded', key, items, cursor });
}

describe('the list of the gallery', () => {
  it('starts loading and becomes ready with the first page and its cursor', () => {
    expect(initialListState('k').status).toBe('loading');
    const state = ready();
    expect(state.status).toBe('ready');
    expect(state.items).toEqual([a, b]);
    expect(state.cursor).toBe('next');
  });

  it('keeps the old results on screen while new filters load', () => {
    const loading = listReducer(ready(), { type: 'load', key: 'other' });
    expect(loading.status).toBe('loading');
    expect(loading.items).toEqual([a, b]);
    expect(loading.cursor).toBeNull();
    expect(loading.key).toBe('other');
  });

  it('ignores an answer for filters that are no longer the current ones', () => {
    const loading = listReducer(ready('old'), { type: 'load', key: 'new' });
    expect(listReducer(loading, { type: 'loaded', key: 'old', items: [c], cursor: null })).toBe(
      loading,
    );
    expect(listReducer(loading, { type: 'failed', key: 'old', error: new Error('x') })).toBe(
      loading,
    );
    expect(listReducer(loading, { type: 'more', key: 'old', items: [c], cursor: null })).toBe(
      loading,
    );
  });

  it('shows an error state with no items when the first page fails', () => {
    const error = new Error('down');
    const failed = listReducer(ready(), { type: 'failed', key: 'k', error });
    expect(failed.status).toBe('error');
    expect(failed.error).toBe(error);
    expect(failed.items).toEqual([]);
  });

  it('appends the next page without repeating a creation that polling or paging returned twice', () => {
    const more = listReducer(ready(), { type: 'more', key: 'k', items: [b, c, d], cursor: null });
    expect(more.items.map((item) => item.id)).toEqual([a.id, b.id, c.id, d.id]);
    expect(more.cursor).toBeNull();
    expect(more.loadingMore).toBe(false);
  });

  it('keeps the list when "load more" fails and remembers why', () => {
    const error = new Error('offline');
    const started = listReducer(ready(), { type: 'more-start', key: 'k' });
    expect(started.loadingMore).toBe(true);
    const failed = listReducer(started, { type: 'more-failed', key: 'k', error });
    expect(failed.items).toEqual([a, b]);
    expect(failed.moreError).toBe(error);
    expect(failed.loadingMore).toBe(false);
    // Trying again clears the error.
    expect(listReducer(failed, { type: 'more-start', key: 'k' }).moreError).toBeUndefined();
  });

  it('replaces updated creations by id and returns the same state when nothing matches', () => {
    const state = ready();
    const done = { ...a, status: 'failed' as const };
    const updated = listReducer(state, { type: 'update', generations: [done, c] });
    expect(updated.items[0]).toBe(done);
    expect(updated.items[1]).toBe(b);
    expect(listReducer(state, { type: 'update', generations: [c] })).toBe(state);
  });

  it('removes creations by id', () => {
    const state = ready();
    expect(listReducer(state, { type: 'remove', ids: [a.id] }).items).toEqual([b]);
    expect(listReducer(state, { type: 'remove', ids: ['gen_unknown'] })).toBe(state);
  });
});
