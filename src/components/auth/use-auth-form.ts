'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import type { z } from 'zod';
import { api } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n/client';
import { safeNextPath } from '@/lib/next-path';
import { describeAuthFailure, type AuthFailure } from './auth-error';
import { shouldValidateOnBlur } from './blur-policy';
import { offerToSaveLogin } from './credential-store';
import { validate, validateField, validationMessage, type FieldName } from './schemas';

export interface UseAuthFormOptions<F extends FieldName> {
  mode: 'login' | 'register';
  /** In visual order: the first invalid one receives focus. */
  fields: readonly F[];
  schema: z.ZodType<Record<F, string>>;
  /** The page to go to after success. Checked again here, whatever the caller passed. */
  next: string;
  /** Added to the request body next to the validated values. */
  extraBody?: Record<string, unknown>;
}

export interface AuthForm<F extends FieldName> {
  values: Record<F, string>;
  /** Text to show under each field (client validation once touched, or what the server said). */
  errors: Partial<Record<F, string>>;
  /** A failure of the whole form. */
  formError: string | null;
  emailTaken: boolean;
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

export function useAuthForm<F extends FieldName>({
  mode,
  fields,
  schema,
  next,
  extraBody,
}: UseAuthFormOptions<F>): AuthForm<F> {
  const i18n = useI18n();
  const router = useRouter();
  const [values, setValues] = useState(
    () => Object.fromEntries(fields.map((field) => [field, ''])) as Record<F, string>,
  );
  const [touched, setTouched] = useState<ReadonlySet<F>>(new Set());
  const [serverErrors, setServerErrors] = useState<Partial<Record<F, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
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
    if (field === 'email') setEmailTaken(false);
  }

  function onBlur(field: F, event?: FocusEvent<HTMLElement>) {
    if (!shouldValidateOnBlur(edited.current.has(field), event)) return;
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
  }

  function applyFailure(failure: AuthFailure) {
    setFormError(failure.form ?? null);
    setServerErrors(failure.fields as Partial<Record<F, string>>);
    setEmailTaken(failure.emailTaken === true);
    const target = failure.focus as F | undefined;
    if (target) elements.current[target]?.focus();
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
    const { email, password, name }: Partial<Record<FieldName, string>> = checked.data;
    api
      .post<unknown>(`/auth/${mode}`, { ...checked.data, ...extraBody })
      .then(() => {
        // The client router gives the browser no page load to learn from that this login worked.
        if (email && password) offerToSaveLogin({ id: email, password, name });
        // Stay in the submitting state while the next page loads: no second click, no flash of the form.
        router.replace(safeNextPath(next));
        router.refresh();
      })
      .catch((error: unknown) => {
        setSubmitting(false);
        applyFailure(describeAuthFailure(error, mode, i18n));
      });
  }

  return {
    values,
    errors: { ...clientErrors, ...serverErrors },
    formError,
    emailTaken,
    submitting,
    setValue,
    onBlur,
    inputRef: (field) => (element) => {
      elements.current[field] = element;
    },
    onSubmit,
  };
}
