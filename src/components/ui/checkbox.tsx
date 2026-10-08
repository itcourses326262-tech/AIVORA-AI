'use client';

import { Check, Minus } from 'lucide-react';
import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useFieldControl } from './field';
import { useMergedRef } from './use-merged-ref';

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  label?: ReactNode;
  description?: ReactNode;
  /** Mixed state (some children checked); purely visual and exposed as `aria-checked="mixed"`. */
  indeterminate?: boolean;
  invalid?: boolean;
  /** Classes for the outer wrapper. */
  wrapperClassName?: string;
}

/** A native checkbox with the system's look, an optional label and description. */
export function Checkbox({
  label,
  description,
  indeterminate = false,
  invalid: invalidProp,
  wrapperClassName,
  className,
  id,
  required,
  disabled,
  ref,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: CheckboxProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const descriptionId = useId();
  const ownId = useId();
  const control = useFieldControl({
    id,
    required,
    disabled,
    invalid: invalidProp,
    'aria-describedby': [describedBy, description ? descriptionId : undefined]
      .filter(Boolean)
      .join(' '),
    'aria-invalid': ariaInvalid,
  });

  const mergedRef = useMergedRef(innerRef, ref);

  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  // `rounded-sm`, not `rounded-md`: the radius scale is generous (md is 10px), which would turn this
  // 20px box into a circle, the shape of a radio.
  const box = (
    <span className="relative mt-0.5 inline-flex size-5 shrink-0">
      <input
        {...props}
        ref={mergedRef}
        id={control.id ?? ownId}
        type="checkbox"
        required={control.required}
        disabled={control.disabled}
        aria-invalid={control['aria-invalid']}
        aria-describedby={control['aria-describedby']}
        aria-checked={indeterminate ? 'mixed' : undefined}
        className={cn(
          'peer absolute inset-0 size-full cursor-pointer appearance-none rounded-sm border bg-surface transition-colors duration-150 checked:border-transparent checked:bg-primary indeterminate:border-transparent indeterminate:bg-primary hover:border-muted disabled:cursor-not-allowed disabled:opacity-50',
          control.invalid ? 'border-danger' : 'border-field',
          className,
        )}
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3.5 scale-50 text-white opacity-0 transition-[opacity,transform] duration-150 peer-checked:scale-100 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      />
      <Minus
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3.5 scale-50 text-white opacity-0 transition-[opacity,transform] duration-150 peer-indeterminate:scale-100 peer-indeterminate:opacity-100"
      />
    </span>
  );

  if (!label) return box;
  return (
    <div className={cn('flex items-start gap-3', wrapperClassName)}>
      {box}
      <div className="grid gap-0.5">
        <label
          htmlFor={control.id ?? ownId}
          className={cn(
            'cursor-pointer text-sm leading-6 font-medium',
            control.disabled && 'opacity-60',
          )}
        >
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
