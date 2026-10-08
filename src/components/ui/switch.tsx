'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useFieldControl } from './field';
import { useControllableState } from './use-controllable-state';

export interface SwitchProps extends Omit<
  ComponentProps<'button'>,
  'role' | 'onChange' | 'value' | 'defaultValue' | 'name'
> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Visible label; clicking it toggles the switch. Without it, pass `aria-label`. */
  label?: ReactNode;
  description?: ReactNode;
  /** Submitted with a form as `name=on` while checked. */
  name?: string;
}

/** An on/off setting that applies immediately (`role="switch"`). */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  label,
  description,
  name,
  className,
  disabled,
  id,
  onClick,
  'aria-describedby': describedBy,
  ...props
}: SwitchProps) {
  const [isOn, setOn] = useControllableState({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });
  const labelId = useId();
  const descriptionId = useId();
  const control = useFieldControl({
    id,
    disabled,
    'aria-describedby': [describedBy, description ? descriptionId : undefined]
      .filter(Boolean)
      .join(' '),
  });

  const track = (
    <button
      {...props}
      id={control.id}
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-labelledby={label ? labelId : props['aria-labelledby']}
      aria-describedby={control['aria-describedby']}
      disabled={control.disabled}
      data-state={isOn ? 'checked' : 'unchecked'}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOn(!isOn);
      }}
      className={cn(
        'group relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-field bg-surface-raised transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-transparent data-[state=checked]:bg-primary',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none ms-[0.2rem] block size-4 rounded-full bg-muted shadow-sm transition-[margin,background-color] duration-200 group-data-[state=checked]:ms-[1.45rem] group-data-[state=checked]:bg-white"
      />
      {name && isOn ? <input type="hidden" name={name} value="on" /> : null}
    </button>
  );

  if (!label) return track;
  return (
    <div className="flex items-start gap-3">
      {track}
      <div className="grid gap-0.5 pt-px">
        <label
          id={labelId}
          htmlFor={control.id}
          className={cn('cursor-pointer text-sm font-medium', control.disabled && 'opacity-60')}
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
