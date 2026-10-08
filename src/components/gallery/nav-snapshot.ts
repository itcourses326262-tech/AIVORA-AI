/**
 * What the gallery tells the detail page and itself across a navigation, kept in `sessionStorage`
 * (this tab only, gone when it closes): the ids of the list in order, so the detail page can offer
 * previous / next within the list the person came from, and the scroll position, so coming back
 * lands where they left instead of at the top of a freshly loaded first page. Every access is in
 * try/catch: private windows and blocked storage simply mean "no snapshot".
 */
import { isValidId } from '@/lib/id';

const STORAGE_KEY = 'aivore.gallery.nav.v1';
/** A snapshot older than this belongs to a different visit. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_IDS = 1000;
const FROM_PATTERN = /^\/gallery(?:\?[^#]*)?$/;

export interface NavSnapshot {
  /** Address of the list (`/gallery?kind=image`): where "back" goes. */
  from: string;
  /** Generation ids in list order. */
  ids: string[];
  scrollY: number;
  /** The list should scroll back to `scrollY` the next time it opens. */
  restore: boolean;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function parseNavSnapshot(raw: string | null, now: number = Date.now()): NavSnapshot | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { from, ids, scrollY, restore, savedAt } = value as Record<string, unknown>;
    if (typeof from !== 'string' || !FROM_PATTERN.test(from)) return null;
    if (!Array.isArray(ids) || ids.length > MAX_IDS) return null;
    if (!ids.every((id): id is string => typeof id === 'string' && isValidId(id, 'gen'))) {
      return null;
    }
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || now - savedAt > MAX_AGE_MS) {
      return null;
    }
    return {
      from,
      ids,
      scrollY: typeof scrollY === 'number' && Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0,
      restore: restore === true,
      savedAt,
    };
  } catch {
    return null;
  }
}

/** The stored text itself: a stable value for `useSyncExternalStore`, parsed by {@link parseNavSnapshot}. */
export function readRawNavSnapshot(): string | null {
  try {
    return storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function readNavSnapshot(now: number = Date.now()): NavSnapshot | null {
  return parseNavSnapshot(readRawNavSnapshot(), now);
}

function write(snapshot: NavSnapshot): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Full or blocked storage: previous / next and scroll restoration are conveniences.
  }
}

export function saveNavSnapshot(
  snapshot: Omit<NavSnapshot, 'savedAt'>,
  now: number = Date.now(),
): void {
  write({ ...snapshot, ids: snapshot.ids.slice(0, MAX_IDS), savedAt: now });
}

/** The list used its scroll position; a later visit starts at the top again. */
export function consumeRestore(now: number = Date.now()): void {
  const snapshot = readNavSnapshot(now);
  if (snapshot?.restore) write({ ...snapshot, restore: false });
}

/** A creation was deleted: it leaves the list the detail page navigates. */
export function forgetInSnapshot(id: string, now: number = Date.now()): void {
  const snapshot = readNavSnapshot(now);
  if (snapshot?.ids.includes(id)) {
    write({ ...snapshot, ids: snapshot.ids.filter((candidate) => candidate !== id) });
  }
}

export interface Neighbors {
  previous: string | null;
  next: string | null;
  /** 1-based place in the list. */
  position: number;
  total: number;
}

/** Previous and next of `id` in the snapshot's list; null when the person did not come from it. */
export function neighborsOf(snapshot: NavSnapshot | null, id: string): Neighbors | null {
  if (!snapshot) return null;
  const index = snapshot.ids.indexOf(id);
  if (index < 0) return null;
  return {
    previous: snapshot.ids[index - 1] ?? null,
    next: snapshot.ids[index + 1] ?? null,
    position: index + 1,
    total: snapshot.ids.length,
  };
}
