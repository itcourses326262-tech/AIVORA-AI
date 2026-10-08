export type Orientation = 'horizontal' | 'vertical';

export interface KeyNavigation {
  orientation: Orientation | 'both';
  rtl: boolean;
  loop?: boolean;
}

/**
 * Index to move to for a navigation key, or null when the key is not one of the group's.
 * Horizontal arrows follow what the user sees: in a right-to-left context ArrowLeft goes to the
 * next item (the one drawn further left) and ArrowRight to the previous one.
 */
export function nextIndexForKey(
  key: string,
  current: number,
  count: number,
  { orientation, rtl, loop = true }: KeyNavigation,
): number | null {
  if (count === 0) return null;
  const horizontal = orientation === 'horizontal' || orientation === 'both';
  const vertical = orientation === 'vertical' || orientation === 'both';
  let step = 0;
  if (horizontal && key === 'ArrowRight') step = rtl ? -1 : 1;
  else if (horizontal && key === 'ArrowLeft') step = rtl ? 1 : -1;
  else if (vertical && key === 'ArrowDown') step = 1;
  else if (vertical && key === 'ArrowUp') step = -1;
  else if (key === 'Home') return 0;
  else if (key === 'End') return count - 1;
  else return null;

  const target = current + step;
  if (target >= 0 && target < count) return target;
  if (!loop) return current < 0 ? 0 : Math.min(Math.max(current, 0), count - 1);
  return (target + count) % count;
}

/** Remembers typed characters for a short while so "Lo" jumps to "Log out". */
export function createTypeahead(timeoutMs = 600) {
  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    /** Appends `char` and returns the index of the first matching label at or after `from`. */
    match(char: string, labels: readonly string[], from: number): number {
      clearTimeout(timer);
      buffer += char.toLowerCase();
      timer = setTimeout(() => {
        buffer = '';
      }, timeoutMs);
      const needle = buffer;
      // Repeating one letter cycles through the items that start with it.
      const search = /^(.)\1+$/.test(needle) ? needle[0]! : needle;
      const start = search.length === 1 ? from + 1 : from;
      for (let offset = 0; offset < labels.length; offset += 1) {
        const index = (start + offset) % labels.length;
        if (labels[index]?.toLowerCase().startsWith(search)) return index;
      }
      return -1;
    },
    reset() {
      clearTimeout(timer);
      buffer = '';
    },
  };
}

export function isPrintableKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}
