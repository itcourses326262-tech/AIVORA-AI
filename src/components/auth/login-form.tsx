'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { useI18n } from '@/lib/i18n/client';
import { AuthHeading, AuthSwitch, authLink } from './auth-parts';
import { PasswordField } from './password-field';
import { loginSchema } from './schemas';
import { EmailField } from './text-fields';
import { useAuthForm } from './use-auth-form';

const FIELDS = ['email', 'password'] as const;

export interface LoginFormProps {
  /** Where to go after logging in: already a safe, same-site path. */
  next: string;
  /** Wide-screen decoration hanging beside the card (see `AuthAside`). */
  aside?: ReactNode;
}

export function LoginForm({ next, aside }: LoginFormProps) {
  const { t } = useI18n();
  const form = useAuthForm({ mode: 'login', fields: FIELDS, schema: loginSchema, next });
  return (
    <div className="relative grid gap-6">
      <AuthHeading title={t('auth.login.title')} subtitle={t('auth.login.subtitle')} />
      <FormError>{form.formError}</FormError>
      <form noValidate onSubmit={form.onSubmit} className="grid gap-5">
        <EmailField
          value={form.values.email}
          onValueChange={(value) => form.setValue('email', value)}
          onBlur={() => form.onBlur('email')}
          error={form.errors.email}
          inputRef={form.inputRef('email')}
        />
        <PasswordField
          label={t('auth.fields.password')}
          value={form.values.password}
          onValueChange={(value) => form.setValue('password', value)}
          onBlur={() => form.onBlur('password')}
          error={form.errors.password}
          autoComplete="current-password"
          inputRef={form.inputRef('password')}
        />
        <Link
          href="/forgot-password"
          className="hit-area -mt-2 w-fit rounded-sm text-sm font-medium text-brand underline-offset-4 hover:underline"
        >
          {t('auth.login.forgot')}
        </Link>
        <Button type="submit" size="lg" fullWidth loading={form.submitting} className="mt-1">
          {form.submitting ? t('auth.login.submitting') : t('auth.login.submit')}
        </Button>
      </form>
      <AuthSwitch prompt={t('auth.login.noAccount')} href={authLink('/register', next)}>
        {t('auth.login.createAccount')}
      </AuthSwitch>
      {aside}
    </div>
  );
}
