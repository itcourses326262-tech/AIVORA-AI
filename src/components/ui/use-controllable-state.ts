import { useCallback, useState } from 'react';

interface Options<T> {
  value: T | undefined;
  defaultValue: T;
  onChange?: (value: T) => void;
}

/** State that is either owned by the caller (`value` given) or by the component itself. */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: Options<T>): [T, (next: T) => void] {
  const [inner, setInner] = useState(defaultValue);
  const controlled = value !== undefined;
  const set = useCallback(
    (next: T) => {
      if (!controlled) setInner(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );
  return [controlled ? value : inner, set];
}
