'use client';

import { Clapperboard, Gift, Languages } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { ConsentLine, CONSENT_LINE_ID } from '@/components/legal/consent-line';
import { creditsLabel } from '@/components/marketing/credits-label';
import { useI18n } from '@/lib/i18n/client';
import { AuthHeading, AuthSwitch, authLink } from './auth-parts';
import { PasswordField } from './password-field';
import { scorePassword } from './password-strength';
import { PasswordStrengthMeter } from './password-strength-meter';
import { registerSchema } from './schemas';
import { EmailField, NameField } from './text-fields';
import { useAuthForm } from './use-auth-form';

const FIELDS = ['name', 'email', 'password'] as const;

export interface RegisterFormProps {
  /** Where to go after signing up: already a safe, same-site path. */
  next: string;
  /** Credits a new account receives (0 leaves the number out). */
  bonus: number;
  /** False when the server has closed registration. */
  signupOpen: boolean;
  /** Wide-screen decoration hanging beside the card (see `AuthAside`). */
  aside?: ReactNode;
}

function Benefits({ bonus }: { bonus: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const items = [
    ...(bonus > 0
      ? [
          {
            icon: Gift,
            text: t('auth.register.benefits.credits', { credits: creditsLabel(i18n, bonus) }),
          },
        ]
      : []),
    { icon: Languages, text: t('auth.register.benefits.languages') },
    { icon: Clapperboard, text: t('auth.register.benefits.studio') },
  ];
  return (
    <ul
      aria-label={t('auth.register.benefitsLabel')}
      className="grid gap-2.5 rounded-2xl border border-brand/20 bg-brand-soft p-4 text-sm text-foreground xl:hidden"
    >
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-center gap-3">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-brand" />
          {text}
        </li>
      ))}
    </ul>
  );
}

export function RegisterForm({ next, bonus, signupOpen, aside }: RegisterFormProps) {
  const { t, locale } = useI18n();
  const form = useAuthForm({
    mode: 'register',
    fields: FIELDS,
    schema: registerSchema,
    next,
    extraBody: { locale },
  });
  const strength = scorePassword(form.values.password, form.values.email);
  const heading = (
    <AuthHeading title={t('auth.register.title')} subtitle={t('auth.register.subtitle')} />
  );
  const switchToLogin = (
    <AuthSwitch prompt={t('auth.register.haveAccount')} href={authLink('/login', next)}>
      {t('auth.register.logIn')}
    </AuthSwitch>
  );

  if (!signupOpen) {
    return (
      <div className="grid gap-6">
        {heading}
        <FormError>{t('auth.register.closed')}</FormError>
        {switchToLogin}
      </div>
    );
  }

  return (
    <div className="relative grid gap-6">
      {heading}
      <Benefits bonus={bonus} />
      <FormError>{form.formError}</FormError>
      <form noValidate onSubmit={form.onSubmit} className="grid gap-5">
        <NameField
          value={form.values.name}
          onValueChange={(value) => form.setValue('name', value)}
          onBlur={() => form.onBlur('name')}
          error={form.errors.name}
          inputRef={form.inputRef('name')}
        />
        <div className="grid gap-2">
          <EmailField
            value={form.values.email}
            onValueChange={(value) => form.setValue('email', value)}
            onBlur={() => form.onBlur('email')}
            error={form.errors.email}
            inputRef={form.inputRef('email')}
          />
          {form.emailTaken ? (
            <Link
              href={authLink('/login', next)}
              className="w-fit rounded-sm text-sm font-medium text-brand underline-offset-4 hover:underline"
            >
              {t('auth.register.logIn')}
            </Link>
          ) : null}
        </div>
        <PasswordField
          label={t('auth.fields.password')}
          value={form.values.password}
          onValueChange={(value) => form.setValue('password', value)}
          onBlur={() => form.onBlur('password')}
          error={form.errors.password}
          autoComplete="new-password"
          inputRef={form.inputRef('password')}
          hint={
            <>
              <span className="block">{t('auth.hints.password')}</span>
              <PasswordStrengthMeter strength={strength} />
            </>
          }
        />
        <ConsentLine />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={form.submitting}
          aria-describedby={CONSENT_LINE_ID}
          className="mt-1"
        >
          {form.submitting ? t('auth.register.submitting') : t('auth.register.submit')}
        </Button>
      </form>
      {switchToLogin}
      {aside}
    </div>
  );
}
