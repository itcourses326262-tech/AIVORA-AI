'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { isRtl } from './dir';
import { nextIndexForKey, type Orientation } from './keyboard';
import { useControllableState } from './use-controllable-state';

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

interface GroupProps {
  options: readonly RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Submitted with a form as `name=value`. */
  name?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
}

/**
 * Shared behaviour of a single-choice group: roving tabindex (only the selected radio, or the first
 * enabled one, is in the Tab order), arrow keys that move and select, RTL-aware.
 */
function useRadioGroup({
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
}: Pick<GroupProps, 'options' | 'value' | 'defaultValue' | 'onValueChange' | 'disabled'>) {
  const [current, setCurrent] = useControllableState({
    value,
    defaultValue,
    onChange: (next: string | undefined) => {
      if (next !== undefined) onValueChange?.(next);
    },
  });
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = options.filter((option) => !option.disabled && !disabled);
  const tabStop =
    enabled.find((option) => option.value === current)?.value ?? enabled[0]?.value ?? undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const values = enabled.map((option) => option.value);
    const index = values.indexOf(
      Array.from(refs.current).find(([, node]) => node === document.activeElement)?.[0] ?? '',
    );
    const next = nextIndexForKey(event.key, index, values.length, {
      // A radio group answers to all four arrows, like native radios.
      orientation: 'both',
      rtl: isRtl(event.currentTarget),
    });
    const target = next === null ? undefined : values[next];
    if (target === undefined) return;
    event.preventDefault();
    refs.current.get(target)?.focus();
    setCurrent(target);
  };

  return {
    current,
    setCurrent,
    tabStop,
    onKeyDown,
    register: (itemValue: string, node: HTMLButtonElement | null) => {
      if (node) refs.current.set(itemValue, node);
      else refs.current.delete(itemValue);
    },
  };
}

export interface RadioGroupProps extends GroupProps {
  /** `list` stacks plain radios; `card` makes each option a bordered tile. */
  appearance?: 'list' | 'card';
  orientation?: Orientation;
}

/** A single-choice group of radios (`role="radiogroup"`). */
export function RadioGroup({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  disabled,
  appearance = 'list',
  orientation = 'vertical',
  className,
  ...aria
}: RadioGroupProps) {
  const groupId = useId();
  const group = useRadioGroup({
    options,
    value,
    defaultValue,
    onValueChange,
    disabled,
  });
  return (
    <div
      role="radiogroup"
      aria-disabled={disabled || undefined}
      {...aria}
      onKeyDown={group.onKeyDown}
      className={cn(
        'flex gap-2',
        orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap',
        className,
      )}
    >
      {options.map((option) => {
        const checked = group.current === option.value;
        const isDisabled = Boolean(disabled || option.disabled);
        const labelId = `${groupId}-${option.value}-label`;
        const descriptionId = `${groupId}-${option.value}-description`;
        return (
          <button
            key={option.value}
            ref={(node) => {
              group.register(option.value, node);
              return () => group.register(option.value, null);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-labelledby={labelId}
            aria-describedby={option.description ? descriptionId : undefined}
            aria-disabled={isDisabled || undefined}
            tabIndex={group.tabStop === option.value ? 0 : -1}
            data-state={checked ? 'checked' : 'unchecked'}
            onClick={() => {
              if (!isDisabled) group.setCurrent(option.value);
            }}
            className={cn(
              'group flex w-full cursor-pointer items-start gap-3 text-start transition-colors duration-150 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
              appearance === 'card' &&
                'rounded-xl border border-border bg-surface p-3.5 hover:border-border-strong data-[state=checked]:border-primary data-[state=checked]:bg-brand-soft',
              appearance === 'list' && 'rounded-md py-1',
              orientation === 'horizontal' && 'w-auto',
            )}
          >
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-field bg-surface transition-colors duration-150 group-hover:border-muted group-data-[state=checked]:border-primary"
            >
              <span className="size-2.5 scale-0 rounded-full bg-primary transition-transform duration-150 group-data-[state=checked]:scale-100" />
            </span>
            <span className="grid gap-0.5">
              <span id={labelId} className="text-sm leading-6 font-medium text-foreground">
                {option.label}
              </span>
              {option.description ? (
                <span id={descriptionId} className="text-sm text-muted">
                  {option.description}
                </span>
              ) : null}
            </span>
            {name && checked ? <input type="hidden" name={name} value={option.value} /> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface SegmentedControlProps extends GroupProps {
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}

/**
 * A compact single-choice switcher (`Image | Video`, `1 | 2 | 3 | 4`) built on radio semantics.
 * The selected segment has a 3:1 edge (`ring-field`) as well as a lighter fill: in the light theme
 * every surface is white, so the fill alone would not tell the selection apart.
 */
export function SegmentedControl({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  disabled,
  size = 'md',
  fullWidth = false,
  className,
  ...aria
}: SegmentedControlProps) {
  const group = useRadioGroup({
    options,
    value,
    defaultValue,
    onValueChange,
    disabled,
  });
  return (
    <div
      role="radiogroup"
      aria-disabled={disabled || undefined}
      {...aria}
      onKeyDown={group.onKeyDown}
      className={cn(
        'inline-flex gap-1 rounded-xl border border-border bg-surface p-1',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {options.map((option) => {
        const checked = group.current === option.value;
        const isDisabled = Boolean(disabled || option.disabled);
        return (
          <button
            key={option.value}
            ref={(node) => {
              group.register(option.value, node);
              return () => group.register(option.value, null);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={isDisabled || undefined}
            tabIndex={group.tabStop === option.value ? 0 : -1}
            data-state={checked ? 'checked' : 'unchecked'}
            onClick={() => {
              if (!isDisabled) group.setCurrent(option.value);
            }}
            className={cn(
              'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap text-muted transition-[background-color,color,box-shadow] duration-150 hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[state=checked]:bg-surface-overlay data-[state=checked]:text-foreground data-[state=checked]:shadow-sm data-[state=checked]:ring-1 data-[state=checked]:ring-field [&_svg]:size-4',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-sm',
              fullWidth && 'flex-1',
            )}
          >
            {option.label}
            {name && checked ? <input type="hidden" name={name} value={option.value} /> : null}
          </button>
        );
      })}
    </div>
  );
}
