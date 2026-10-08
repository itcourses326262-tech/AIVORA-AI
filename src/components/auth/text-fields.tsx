'use client';

import type { Ref } from 'react';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/client';

interface TextFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** The email address: typed left to right whatever the page language, with the usual keyboard and autofill hints. */
export function EmailField({ value, onValueChange, onBlur, error, inputRef }: TextFieldProps) {
  const { t } = useI18n();
  return (
    <Field label={t('auth.fields.email')} error={error} required>
      <Input
        ref={inputRef}
        name="email"
        type="email"
        dir="ltr"
        className="rtl:text-end"
        size="lg"
        inputMode="email"
        autoComplete="email"
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
    <Field label={t('auth.fields.name')} error={error} required>
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
