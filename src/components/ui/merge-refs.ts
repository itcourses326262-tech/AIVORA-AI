import type { Ref, RefCallback } from 'react';

/** Points a callback or object ref at `node`. */
export function setRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

/** One ref callback that fills every given ref (callback or object) and clears them on unmount. */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    const undo = refs.map((ref) => {
      if (typeof ref === 'function') {
        const cleanup = ref(node);
        return typeof cleanup === 'function' ? cleanup : () => ref(null);
      }
      if (ref) {
        ref.current = node;
        return () => {
          ref.current = null;
        };
      }
      return () => {};
    });
    return () => {
      for (const fn of undo) fn();
    };
  };
}
