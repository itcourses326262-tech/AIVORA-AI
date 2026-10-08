'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

interface FieldContextValue {
  controlId: string;
  hintId: string | undefined;
  errorId: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  label: ReactNode;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Error text; its presence marks the control invalid (`aria-invalid`) and announces it. */
  error?: ReactNode;
  required?: boolean;
  /** Appends a localized "(optional)" to the label. */
  optional?: boolean;
  disabled?: boolean;
  /** Id of the control; generated when omitted. */
  id?: string;
  /** Keeps the label for assistive technology only. */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Label, control, hint and error wired together: the label targets the control, the hint and the
 * error are listed in its `aria-describedby`, and `aria-invalid`/`required` follow the props.
 * `Input`, `Textarea`, `Select`, `Checkbox` and `Switch` inside a Field pick all of this up.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  disabled = false,
  id,
  hideLabel = false,
  className,
  children,
}: FieldProps) {
  const { t } = useI18n();
  const generated = useId();
  const controlId = id ?? `field-${generated.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const hasHint = hint !== undefined && hint !== null && hint !== false;
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const value: FieldContextValue = {
    controlId,
    hintId: hasHint ? `${controlId}-hint` : undefined,
    errorId: hasError ? `${controlId}-error` : undefined,
    invalid: hasError,
    required,
    disabled,
  };
  return (
    <FieldContext.Provider value={value}>
      <div className={cn('grid gap-1.5', className)}>
        <label
          htmlFor={controlId}
          className={cn('text-sm font-medium text-foreground', hideLabel && 'sr-only')}
        >
          {label}
          {required ? (
            <span aria-hidden="true" className="ms-0.5 text-danger">
              *
            </span>
          ) : null}
          {optional ? (
            <span className="ms-1.5 text-xs font-normal text-subtle">
              ({t('common.form.optional')})
            </span>
          ) : null}
        </label>
        {children}
        {hasHint ? (
          <p id={value.hintId} className="text-sm text-muted">
            {hint}
          </p>
        ) : null}
        {hasError ? (
          <p
            id={value.errorId}
            role="alert"
            className="flex items-start gap-1.5 text-sm text-danger"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}

export interface FieldControlAttributes {
  id: string | undefined;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  required: boolean | undefined;
  disabled: boolean | undefined;
  invalid: boolean;
}

/**
 * The accessibility attributes a form control should render: its own props merged with those of
 * the surrounding {@link Field}, if any (the field's id wins, so the label always matches).
 */
export function useFieldControl(props: ControlProps): FieldControlAttributes {
  const field = useContext(FieldContext);
  const describedBy = [props['aria-describedby'], field?.hintId, field?.errorId]
    .filter(Boolean)
    .join(' ');
  const invalid =
    Boolean(props.invalid) ||
    (props['aria-invalid'] !== undefined &&
      props['aria-invalid'] !== false &&
      props['aria-invalid'] !== 'false') ||
    Boolean(field?.invalid);
  return {
    id: field?.controlId ?? props.id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': invalid ? true : undefined,
    required: props.required ?? field?.required,
    disabled: props.disabled ?? field?.disabled,
    invalid,
  };
}
