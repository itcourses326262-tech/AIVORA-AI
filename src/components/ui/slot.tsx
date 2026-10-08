import { Children, cloneElement, type HTMLAttributes, type ReactElement, type Ref } from 'react';
import { cn } from '@/lib/utils';
import { useMergedRef } from './use-merged-ref';

export type SlotProps = HTMLAttributes<HTMLElement> & {
  ref?: Ref<HTMLElement>;
  /** The single element that receives the props. */
  children: ReactElement<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>;
};

type AnyProps = Record<string, unknown>;

function isHandlerKey(key: string): boolean {
  return /^on[A-Z]/.test(key);
}

function wasPrevented(event: unknown): boolean {
  return (
    typeof event === 'object' &&
    event !== null &&
    'defaultPrevented' in event &&
    event.defaultPrevented === true
  );
}

/** Slot props go on top of the child's: handlers run child first, ids and classes are combined. */
function mergeProps(slot: AnyProps, child: AnyProps): AnyProps {
  const merged: AnyProps = { ...child };
  for (const [key, slotValue] of Object.entries(slot)) {
    const childValue = child[key];
    if (isHandlerKey(key) && typeof slotValue === 'function' && typeof childValue === 'function') {
      merged[key] = (...args: unknown[]) => {
        childValue(...args);
        if (!wasPrevented(args[0])) slotValue(...args);
      };
    } else if (
      (key === 'aria-describedby' || key === 'aria-labelledby') &&
      typeof slotValue === 'string' &&
      typeof childValue === 'string'
    ) {
      merged[key] = `${childValue} ${slotValue}`;
    } else if (key === 'className') {
      merged[key] = cn(childValue as string | undefined, slotValue as string | undefined);
    } else if (key === 'style') {
      merged[key] = { ...(childValue as object | undefined), ...(slotValue as object | undefined) };
    } else if (slotValue !== undefined) {
      merged[key] = slotValue;
    }
  }
  return merged;
}

/**
 * Hands its props (and ref) to its single child instead of rendering an element of its own. It is
 * how a tooltip or a menu attaches behaviour to a trigger the caller supplies.
 */
export function Slot({ children, ref, ...slotProps }: SlotProps) {
  const child = Children.only(children);
  const mergedRef = useMergedRef(ref, child.props.ref);
  return cloneElement(child, {
    ...mergeProps(slotProps as AnyProps, child.props as AnyProps),
    ref: mergedRef,
  });
}
