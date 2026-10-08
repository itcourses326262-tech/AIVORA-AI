import { useMemo, type Ref, type RefCallback } from 'react';
import { mergeRefs } from './merge-refs';

/** `mergeRefs` memoized on its inputs, so React does not detach and re-attach the ref every render. */
export function useMergedRef<T>(a: Ref<T> | undefined, b: Ref<T> | undefined): RefCallback<T> {
  return useMemo(() => mergeRefs(a, b), [a, b]);
}
