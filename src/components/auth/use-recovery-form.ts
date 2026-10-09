'use client';

import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import type { z } from 'zod';
import { useI18n } from '@/lib/i18n/client';
import { describeRecoveryFailure, type RecoveryField } from './recovery-error';
import { shouldValidateOnBlur } from './blur-policy';
import { validate, validateField, validationMessage } from './schemas';

export interface UseRecoveryFormOptions<F extends RecoveryField> {
  /** In visual order: the first invalid one receives focus. */
  fields: readonly F[];
  schema: z.ZodType<Record<F, string>>;
  /** Sends the validated values. Throws what the API client throws; resolving means it worked. */
  submit: (data: Record<F, string>) => Promise<void>;
}

export interface RecoveryForm<F extends RecoveryField> {
  values: Record<F, string>;
  /** Text to show under each field (client validation once touched, or what the server said). */
  errors: Partial<Record<F, string>>;
  formError: string | null;
  submitting: boolean;
  setValue: (field: F, value: string) => void;
  onBlur: (field: F, event?: FocusEvent<HTMLElement>) => void;
  inputRef: (field: F) => (element: HTMLInputElement | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/** The first field takes focus on load, but only where a keyboard is at hand: a phone would pop up its keyboard over the page. */
function prefersAutofocus(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}

/**
 * The form state of the account-recovery pages: touched-field validation with the same schemas'
 * codes as the log in form, server failures pinned to fields, one request in flight at a time.
 * What happens after a success is the caller's business (it usually swaps the form for a panel).
 */
export function useRecoveryForm<F extends RecoveryField>({
  fields,
  schema,
  submit,
}: UseRecoveryFormOptions<F>): RecoveryForm<F> {
  const i18n = useI18n();
  const [values, setValues] = useState(
    () => Object.fromEntries(fields.map((field) => [field, ''])) as Record<F, string>,
  );
  const [touched, setTouched] = useState<ReadonlySet<F>>(new Set());
  const [serverErrors, setServerErrors] = useState<Partial<Record<F, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const elements = useRef<Partial<Record<F, HTMLInputElement | null>>>({});
  const edited = useRef(new Set<F>());

  const firstField = fields[0];
  useEffect(() => {
    if (firstField && prefersAutofocus()) elements.current[firstField]?.focus();
  }, [firstField]);

  const clientErrors: Partial<Record<F, string>> = {};
  for (const field of touched) {
    const code = validateField(schema, field, values);
    if (code) {
      const { key, vars } = validationMessage(code);
      clientErrors[field] = i18n.t(key, vars);
    }
  }

  function setValue(field: F, value: string) {
    edited.current.add(field);
    setValues((current) => ({ ...current, [field]: value }));
    // Editing a field answers whatever the server said about it.
    setServerErrors((current) => {
      if (!current[field]) return current;
      const { [field]: _removed, ...rest } = current;
      return rest as Partial<Record<F, string>>;
    });
  }

  function onBlur(field: F, event?: FocusEvent<HTMLElement>) {
    if (!shouldValidateOnBlur(edited.current.has(field), event)) return;
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const checked = validate(schema, values);
    if (!checked.ok) {
      setTouched(new Set(fields));
      const firstInvalid = fields.find((field) => checked.errors[field]);
      if (firstInvalid) elements.current[firstInvalid]?.focus();
      return;
    }

    setSubmitting(true);
    submit(checked.data)
      .catch((error: unknown) => {
        const failure = describeRecoveryFailure(error, i18n);
        setFormError(failure.form ?? null);
        setServerErrors(failure.fields as Partial<Record<F, string>>);
        const target = failure.focus as F | undefined;
        if (target) elements.current[target]?.focus();
      })
      .finally(() => setSubmitting(false));
  }

  return {
    values,
    errors: { ...clientErrors, ...serverErrors },
    formError,
    submitting,
    setValue,
    onBlur,
    inputRef: (field) => (element) => {
      elements.current[field] = element;
    },
    onSubmit,
  };
}
