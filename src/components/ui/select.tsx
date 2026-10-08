'use client';

import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
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

export interface SelectProps extends Omit<ComponentProps<'select'>, 'size'> {
  size?: ControlSize;
  invalid?: boolean;
  boxClassName?: string;
}

/** A native `<select>` with the system's look: full keyboard and mobile-picker support for free. */
export function Select({
  size = 'md',
  invalid: invalidProp,
  boxClassName,
  className,
  children,
  id,
  required,
  disabled,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: SelectProps) {
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
        'relative',
        CONTROL_BOX,
        control.invalid ? CONTROL_BORDER_INVALID : CONTROL_BORDER,
        CONTROL_FOCUS,
        CONTROL_DISABLED,
        CONTROL_SIZES[size],
        boxClassName,
      )}
    >
      <select
        {...props}
        id={control.id}
        required={control.required}
        disabled={control.disabled}
        aria-invalid={control['aria-invalid']}
        aria-describedby={control['aria-describedby']}
        className={cn(
          'block w-full cursor-pointer appearance-none bg-transparent py-2 ps-3 pe-9 outline-none disabled:cursor-not-allowed [&>option]:bg-surface-overlay [&>option]:text-foreground',
          CONTROL_SIZES[size],
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
      />
    </div>
  );
}
