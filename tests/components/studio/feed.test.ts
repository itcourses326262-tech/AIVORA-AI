import { describe, expect, it } from 'vitest';
import {
  INITIAL_FEED,
  feedReducer,
  type FeedItem,
  type FeedState,
} from '@/components/studio/use-generation-feed';
import { generationDTO } from '../generations/support';

const item = (generation = generationDTO(), pending = false, key = generation.id): FeedItem => ({
  key,
  generation,
  pending,
});

const stateOf = (...items: FeedItem[]): FeedState => ({ ...INITIAL_FEED, status: 'ready', items });
const ids = (state: FeedState) => state.items.map((entry) => entry.generation.id);

describe('feed: a generation is never on the list twice', () => {
  it('swaps the optimistic card for the real generation, in the same place', () => {
    const real = generationDTO({ status: 'queued' });
    const older = generationDTO();
    const state = stateOf(item(generationDTO(), true, 'local-1'), item(older));
    const next = feedReducer(state, { type: 'settle', key: 'local-1', generation: real });
    expect(ids(next)).toEqual([real.id, older.id]);
    expect(next.items[0]).toMatchObject({ key: 'local-1', pending: false });
  });

  it('drops the other card of the same generation when the history answered before the request did', () => {
    const real = generationDTO({ status: 'processing' });
    const older = generationDTO();
    // The history already holds the new generation; the optimistic card is still waiting.
    const state = stateOf(item(generationDTO(), true, 'local-1'), item(real), item(older));
    const next = feedReducer(state, { type: 'settle', key: 'local-1', generation: real });
    expect(ids(next)).toEqual([real.id, older.id]);
  });

  it('leaves one card when several requests were answered with the same generation (a replay)', () => {
    const real = generationDTO({ status: 'queued' });
    let state = stateOf(
      item(generationDTO(), true, 'local-3'),
      item(generationDTO(), true, 'local-2'),
      item(generationDTO(), true, 'local-1'),
    );
    for (const key of ['local-1', 'local-2', 'local-3']) {
      state = feedReducer(state, { type: 'settle', key, generation: real });
    }
    expect(ids(state)).toEqual([real.id]);
  });

  it('does not lose the cards of other generations when one is settled', () => {
    const a = generationDTO();
    const b = generationDTO();
    const real = generationDTO();
    const next = feedReducer(stateOf(item(generationDTO(), true, 'local-1'), item(a), item(b)), {
      type: 'settle',
      key: 'local-1',
      generation: real,
    });
    expect(ids(next)).toEqual([real.id, a.id, b.id]);
  });
});

describe('feed: sync', () => {
  it('adds what the server has and the list lacks, under the cards still being created', () => {
    const known = generationDTO();
    const made = generationDTO({ status: 'processing' });
    const state = stateOf(item(generationDTO(), true, 'local-1'), item(known));
    const next = feedReducer(state, { type: 'sync', items: [made, known] });
    expect(next.items.map((entry) => entry.key)).toEqual(['local-1', made.id, known.id]);
    expect(next.items[1]).toMatchObject({ pending: false });
  });

  it('changes nothing when the list is up to date', () => {
    const known = generationDTO();
    const state = stateOf(item(known));
    expect(feedReducer(state, { type: 'sync', items: [known] })).toBe(state);
  });

  it('keeps the copy it has of a generation it already knows', () => {
    const known = generationDTO({ status: 'succeeded' });
    const state = stateOf(item(known));
    const stale = { ...known, status: 'processing' as const };
    expect(feedReducer(state, { type: 'sync', items: [stale] }).items[0]?.generation).toBe(known);
  });
});
