import { describe, expect, it } from 'vitest';
import {
  INITIAL_SELECTION,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '@/components/gallery/selection';

const order = ['a', 'b', 'c', 'd', 'e'];

function run(...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, INITIAL_SELECTION);
}

const ids = (state: SelectionState) => [...state.ids].sort();

describe('selection mode', () => {
  it('starts off, turns on and off, and forgets everything on exit', () => {
    expect(INITIAL_SELECTION.active).toBe(false);
    const on = run({ type: 'enter' }, { type: 'toggle', id: 'a' });
    expect(on.active).toBe(true);
    expect(ids(on)).toEqual(['a']);
    expect(run({ type: 'enter' }, { type: 'toggle', id: 'a' }, { type: 'exit' })).toEqual(
      INITIAL_SELECTION,
    );
  });

  it('entering twice changes nothing', () => {
    const once = run({ type: 'enter' });
    expect(selectionReducer(once, { type: 'enter' })).toBe(once);
  });
});

describe('choosing', () => {
  it('toggles one id on and off and remembers the last one as the anchor', () => {
    const state = run({ type: 'toggle', id: 'b' }, { type: 'toggle', id: 'c' });
    expect(ids(state)).toEqual(['b', 'c']);
    expect(state.anchor).toBe('c');
    expect(ids(selectionReducer(state, { type: 'toggle', id: 'b' }))).toEqual(['c']);
  });

  it('selects the whole range between the anchor and a shift-click, either way round', () => {
    const forward = run({ type: 'toggle', id: 'b' }, { type: 'range', id: 'd', order });
    expect(ids(forward)).toEqual(['b', 'c', 'd']);
    const backward = run({ type: 'toggle', id: 'd' }, { type: 'range', id: 'b', order });
    expect(ids(backward)).toEqual(['b', 'c', 'd']);
    expect(forward.anchor).toBe('d');
  });

  it('deselects a range when the anchor itself was deselected', () => {
    const state = run(
      { type: 'select-all', ids: order },
      { type: 'toggle', id: 'b' }, // b is now off and the anchor
      { type: 'range', id: 'd', order },
    );
    expect(ids(state)).toEqual(['a', 'e']);
  });

  it('treats a shift-click without a usable anchor as an ordinary click', () => {
    expect(ids(run({ type: 'range', id: 'c', order }))).toEqual(['c']);
    expect(ids(run({ type: 'toggle', id: 'zzz' }, { type: 'range', id: 'c', order }))).toEqual([
      'c',
      'zzz',
    ]);
  });

  it('selects all, clears, and keeps only the ids that failed', () => {
    const all = run({ type: 'select-all', ids: order });
    expect(ids(all)).toEqual(order);
    expect(ids(selectionReducer(all, { type: 'keep', ids: ['b', 'x'] }))).toEqual(['b']);
    const cleared = selectionReducer(all, { type: 'clear' });
    expect(cleared.ids.size).toBe(0);
    expect(cleared.anchor).toBeNull();
    expect(cleared.active).toBe(INITIAL_SELECTION.active);
  });

  it('never mutates the state it was given', () => {
    const before = run({ type: 'toggle', id: 'a' });
    const snapshot = [...before.ids];
    selectionReducer(before, { type: 'toggle', id: 'b' });
    selectionReducer(before, { type: 'select-all', ids: order });
    expect([...before.ids]).toEqual(snapshot);
  });
});
