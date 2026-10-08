'use client';

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  CONTROL_BORDER,
  CONTROL_BORDER_INVALID,
  CONTROL_BOX,
  CONTROL_DISABLED,
  CONTROL_FOCUS,
  CONTROL_SIZES,
  type ControlSize,
} from './control-styles';
import { useFieldControl } from './field';

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: ControlSize;
  invalid?: boolean;
  /** Content at the inline start inside the box (an icon, a unit). */
  startAdornment?: ReactNode;
  /** Content at the inline end inside the box (a button, a unit). */
  endAdornment?: ReactNode;
  /** Classes for the bordered box; `className` goes to the `<input>` itself. */
  boxClassName?: string;
}

/** Single-line text input. Inside a `Field` it is labelled, described and validated for you. */
export function Input({
  size = 'md',
  invalid: invalidProp,
  startAdornment,
  endAdornment,
  boxClassName,
  className,
  id,
  required,
  disabled,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const control = useFieldControl({
    id,
    required,
    disabled,
    invalid: invalidProp,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
  });
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3',
        CONTROL_BOX,
        control.invalid ? CONTROL_BORDER_INVALID : CONTROL_BORDER,
        CONTROL_FOCUS,
        CONTROL_DISABLED,
        CONTROL_SIZES[size],
        boxClassName,
      )}
    >
      {startAdornment ? (
        <span className="flex shrink-0 items-center text-subtle [&_svg]:size-4">
          {startAdornment}
        </span>
      ) : null}
      <input
        {...props}
        id={control.id}
        required={control.required}
        disabled={control.disabled}
        aria-invalid={control['aria-invalid']}
        aria-describedby={control['aria-describedby']}
        className={cn(
          'min-w-0 flex-1 self-stretch bg-transparent py-2 outline-none placeholder:text-subtle disabled:cursor-not-allowed',
          className,
        )}
      />
      {endAdornment ? (
        <span className="flex shrink-0 items-center text-subtle [&_svg]:size-4">
          {endAdornment}
        </span>
      ) : null}
    </div>
  );
}
