'use client';

import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { api } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n/client';
import { AuthHeading } from './auth-parts';
import { BackToLogin } from './back-to-login';
import { isolateLtr } from './bidi';
import { forgotSchema } from './recovery-schemas';
import { StatusPanel } from './status-panel';
import { EmailField } from './text-fields';
import { useRecoveryForm } from './use-recovery-form';

const FIELDS = ['email'] as const;

/**
 * Asks for the account's email and says "check your inbox" whatever the address is: the server
 * answers every valid-looking address the same way, and so does this page.
 */
export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useRecoveryForm({
    fields: FIELDS,
    schema: forgotSchema,
    submit: async ({ email }) => {
      await api.post('/auth/password/forgot', { email });
      setSentTo(email);
    },
  });

  if (sentTo !== null) {
    return (
      <div className="grid gap-6">
        <StatusPanel
          tone="info"
          icon={MailCheck}
          title={t('auth.forgot.sentTitle')}
          actions={
            <Button variant="secondary" fullWidth onClick={() => setSentTo(null)}>
              {t('auth.forgot.useAnother')}
            </Button>
          }
        >
          <p>{t('auth.forgot.sentBody', { email: isolateLtr(sentTo) })}</p>
          <p>{t('auth.forgot.sentHint')}</p>
        </StatusPanel>
        <BackToLogin>{t('auth.forgot.backToLogin')}</BackToLogin>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <AuthHeading title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')} />
      <FormError>{form.formError}</FormError>
      <form noValidate onSubmit={form.onSubmit} className="grid gap-5">
        <EmailField
          value={form.values.email}
          onValueChange={(value) => form.setValue('email', value)}
          onBlur={(event) => form.onBlur('email', event)}
          error={form.errors.email}
          inputRef={form.inputRef('email')}
        />
        <Button type="submit" size="lg" fullWidth loading={form.submitting} className="mt-1">
          {form.submitting ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
        </Button>
      </form>
      <BackToLogin>{t('auth.forgot.backToLogin')}</BackToLogin>
    </div>
  );
}
