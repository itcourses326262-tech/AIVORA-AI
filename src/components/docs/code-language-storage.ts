import {
  DEFAULT_QUICKSTART_LANGUAGE,
  isQuickstartLanguage,
  type QuickstartLanguage,
} from './snippets';

/**
 * The code language a reader picked, kept in `localStorage` on their own device (never sent to the
 * server, and no cookie: the documentation is public). Storage can be missing or throw (private
 * mode, blocked site data), so every access is guarded and a refused write is remembered in memory
 * for the rest of the visit.
 */
export const CODE_LANGUAGE_STORAGE_KEY = 'aivore.docs.language';

const listeners = new Set<() => void>();
let refusedChoice: QuickstartLanguage | undefined;

export function readCodeLanguage(): QuickstartLanguage {
  try {
    const stored = window.localStorage.getItem(CODE_LANGUAGE_STORAGE_KEY);
    return isQuickstartLanguage(stored) ? stored : DEFAULT_QUICKSTART_LANGUAGE;
  } catch {
    return refusedChoice ?? DEFAULT_QUICKSTART_LANGUAGE;
  }
}

export function writeCodeLanguage(language: QuickstartLanguage): void {
  try {
    window.localStorage.setItem(CODE_LANGUAGE_STORAGE_KEY, language);
    refusedChoice = undefined;
  } catch {
    refusedChoice = language;
  }
  for (const listener of [...listeners]) listener();
}

/** For `useSyncExternalStore`: same-tab writes and changes made in another tab both notify. */
export function subscribeToCodeLanguage(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CODE_LANGUAGE_STORAGE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}
