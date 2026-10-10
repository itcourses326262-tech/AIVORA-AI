'use client';

import type { FocusEvent, Ref } from 'react';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/client';

interface TextFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}

interface EmailFieldProps extends TextFieldProps {
  /**
   * `username` where the address is what the person logs in with (log in, sign up): the browser's
   * password manager then saves and fills it together with the password. `email` where it is just
   * an address (asking for a reset link).
   */
  autoComplete?: 'email' | 'username';
}

/**
 * The email address: typed left to right whatever the page language, with the usual keyboard and
 * autofill hints. Its `id` and `name` are fixed (`email`), which is what password managers
 * recognise a saved form by; a page has one of these.
 */
export function EmailField({
  value,
  onValueChange,
  onBlur,
  error,
  inputRef,
  autoComplete = 'email',
}: EmailFieldProps) {
  const { t } = useI18n();
  return (
    <Field id="email" label={t('auth.fields.email')} error={error} required>
      <Input
        ref={inputRef}
        name="email"
        type="email"
        dir="ltr"
        className="rtl:text-end"
        size="lg"
        inputMode="email"
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t('auth.fields.emailPlaceholder')}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={onBlur}
      />
    </Field>
  );
}

export function NameField({ value, onValueChange, onBlur, error, inputRef }: TextFieldProps) {
  const { t } = useI18n();
  return (
    <Field id="name" label={t('auth.fields.name')} error={error} required>
      <Input
        ref={inputRef}
        name="name"
        type="text"
        size="lg"
        autoComplete="name"
        placeholder={t('auth.fields.namePlaceholder')}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={onBlur}
      />
    </Field>
  );
}
