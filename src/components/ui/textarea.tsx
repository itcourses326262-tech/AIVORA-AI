'use client';

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
} from 'react';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatNumber } from '@/lib/utils';
import {
  CONTROL_BORDER,
  CONTROL_BORDER_INVALID,
  CONTROL_BOX,
  CONTROL_DISABLED,
  CONTROL_FOCUS,
} from './control-styles';
import { useFieldControl } from './field';
import { useMergedRef } from './use-merged-ref';

export interface TextareaProps extends ComponentProps<'textarea'> {
  invalid?: boolean;
  /** Grow with the content instead of scrolling, up to `maxRows`. */
  autoGrow?: boolean;
  /** Visible rows when empty (the minimum height). */
  rows?: number;
  maxRows?: number;
  /** Show a live `n / maxLength` counter (needs `maxLength`). */
  showCount?: boolean;
  boxClassName?: string;
}

/** Multi-line text input with optional auto-grow and character counter. */
export function Textarea({
  invalid: invalidProp,
  autoGrow = false,
  rows = 3,
  maxRows = 12,
  showCount = false,
  maxLength,
  boxClassName,
  className,
  id,
  required,
  disabled,
  value,
  defaultValue,
  onChange,
  ref,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: TextareaProps) {
  const { t, locale } = useI18n();
  const countId = useId();
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const [uncontrolledLength, setUncontrolledLength] = useState(String(defaultValue ?? '').length);
  const length = value !== undefined ? String(value).length : uncontrolledLength;
  const counting = showCount && maxLength !== undefined;
  const control = useFieldControl({
    id,
    required,
    disabled,
    invalid: invalidProp,
    'aria-describedby': [describedBy, counting ? countId : undefined].filter(Boolean).join(' '),
    'aria-invalid': ariaInvalid,
  });

  const mergedRef = useMergedRef(innerRef, ref);

  const grow = useCallback(() => {
    const element = innerRef.current;
    if (!element || !autoGrow) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [autoGrow]);

  // Re-measure after every render: the value may have changed from outside (controlled or reset).
  useLayoutEffect(grow);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setUncontrolledLength(event.target.value.length);
    onChange?.(event);
  };

  const remaining = maxLength === undefined ? Infinity : maxLength - length;
  return (
    <div
      className={cn(
        CONTROL_BOX,
        control.invalid ? CONTROL_BORDER_INVALID : CONTROL_BORDER,
        CONTROL_FOCUS,
        CONTROL_DISABLED,
        boxClassName,
      )}
    >
      <textarea
        {...props}
        ref={mergedRef}
        id={control.id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        required={control.required}
        disabled={control.disabled}
        aria-invalid={control['aria-invalid']}
        aria-describedby={control['aria-describedby']}
        onChange={handleChange}
        style={{
          ...props.style,
          maxHeight: autoGrow ? `calc(${maxRows} * 1.5em + 1.25rem)` : undefined,
        }}
        className={cn(
          'block w-full bg-transparent px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-subtle disabled:cursor-not-allowed',
          autoGrow ? 'resize-none overflow-y-auto' : 'resize-y',
          className,
        )}
      />
      {counting ? (
        <p
          id={countId}
          className={cn(
            'flex justify-end px-3 pb-2 text-xs tabular-nums',
            remaining <= 0
              ? 'text-danger'
              : remaining <= Math.max(10, maxLength * 0.1)
                ? 'text-warning'
                : 'text-subtle',
          )}
        >
          <span aria-hidden="true">
            {formatNumber(length, locale)} / {formatNumber(maxLength, locale)}
          </span>
          <span className="sr-only">
            {t('common.form.characterCount', { count: length, max: maxLength })}
          </span>
        </p>
      ) : null}
    </div>
  );
}
