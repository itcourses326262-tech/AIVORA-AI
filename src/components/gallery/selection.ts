/**
 * Multi-select mode of the gallery as a pure reducer: whether the mode is on, which ids are chosen
 * and the anchor of a shift-click range. Ids that left the list are dropped by the view
 * (`selectedItems`), so the reducer never has to know about the list.
 */

export interface SelectionState {
  active: boolean;
  ids: ReadonlySet<string>;
  /** The last id clicked without Shift: where a range starts. */
  anchor: string | null;
}

export type SelectionAction =
  | { type: 'enter' }
  | { type: 'exit' }
  | { type: 'toggle'; id: string }
  /** Selects (or, when the anchor was deselected, clears) every id from the anchor to `id`. */
  | { type: 'range'; id: string; order: readonly string[] }
  | { type: 'select-all'; ids: readonly string[] }
  | { type: 'clear' }
  /** Keeps only these ids (the failed ones after a bulk action). */
  | { type: 'keep'; ids: readonly string[] };

export const INITIAL_SELECTION: SelectionState = {
  active: false,
  ids: new Set(),
  anchor: null,
};

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'enter':
      return state.active ? state : { ...state, active: true };
    case 'exit':
      return INITIAL_SELECTION;
    case 'toggle': {
      const ids = new Set(state.ids);
      if (!ids.delete(action.id)) ids.add(action.id);
      return { ...state, ids, anchor: action.id };
    }
    case 'range': {
      const from = state.anchor === null ? -1 : action.order.indexOf(state.anchor);
      const to = action.order.indexOf(action.id);
      // Without a usable anchor a shift-click is an ordinary click.
      if (from < 0 || to < 0) return selectionReducer(state, { type: 'toggle', id: action.id });
      const [start, end] = from < to ? [from, to] : [to, from];
      const ids = new Set(state.ids);
      // The range follows the anchor: it selects, unless the anchor itself is not selected.
      const select = state.ids.has(state.anchor as string);
      for (const id of action.order.slice(start, end + 1)) {
        if (select) ids.add(id);
        else ids.delete(id);
      }
      return { ...state, ids, anchor: action.id };
    }
    case 'select-all':
      return { ...state, ids: new Set(action.ids) };
    case 'clear':
      return { ...state, ids: new Set(), anchor: null };
    case 'keep': {
      const keep = new Set(action.ids);
      return { ...state, ids: new Set([...state.ids].filter((id) => keep.has(id))) };
    }
  }
}
