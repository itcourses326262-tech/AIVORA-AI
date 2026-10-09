'use client';

import { CircleCheck, LinkIcon, TimerOff, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { api } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n/client';
import { AuthHeading } from './auth-parts';
import { PasswordField } from './password-field';
import { scorePassword } from './password-strength';
import { PasswordStrengthMeter } from './password-strength-meter';
import { linkProblemOf, type LinkProblem } from './recovery-error';
import { resetSchema } from './recovery-schemas';
import { StatusPanel } from './status-panel';
import { useRecoveryForm } from './use-recovery-form';

const FIELDS = ['password'] as const;

const PROBLEM_ICON: Record<LinkProblem, LucideIcon> = {
  invalid: LinkIcon,
  expired: TimerOff,
  used: TriangleAlert,
};

export interface ResetPasswordFormProps {
  /** The `?token=` of the emailed link; null when the link had none. */
  token: string | null;
}

/** A link that cannot work: say why and offer a fresh one. */
function ProblemPanel({ problem }: { problem: LinkProblem }) {
  const { t } = useI18n();
  return (
    <StatusPanel
      tone="danger"
      icon={PROBLEM_ICON[problem]}
      title={t(`auth.reset.problem.${problem}.title`)}
      actions={
        <Button href="/forgot-password" size="lg" fullWidth>
          {t('auth.reset.requestNew')}
        </Button>
      }
    >
      <p>{t(`auth.reset.problem.${problem}.body`)}</p>
    </StatusPanel>
  );
}

/**
 * Sets the new password for an emailed reset link. The link's state decides what the page shows:
 * a form while it can still work, otherwise the reason it cannot (invalid, expired, already used).
 * A password the server's policy refuses keeps the form (and the link) as it is.
 */
export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<'done' | LinkProblem | null>(token ? null : 'invalid');
  const form = useRecoveryForm({
    fields: FIELDS,
    schema: resetSchema,
    submit: async ({ password }) => {
      try {
        await api.post('/auth/password/reset', { token, password });
        setOutcome('done');
      } catch (error) {
        const problem = linkProblemOf(error);
        if (!problem) throw error;
        setOutcome(problem);
      }
    },
  });

  if (outcome === 'done') {
    return (
      <StatusPanel
        tone="success"
        icon={CircleCheck}
        title={t('auth.reset.successTitle')}
        actions={
          <Button href="/login" size="lg" fullWidth>
            {t('auth.reset.logIn')}
          </Button>
        }
      >
        <p>{t('auth.reset.successBody')}</p>
      </StatusPanel>
    );
  }
  if (outcome !== null) return <ProblemPanel problem={outcome} />;

  const strength = scorePassword(form.values.password, '');
  return (
    <div className="grid gap-6">
      <AuthHeading title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')} />
      <FormError>{form.formError}</FormError>
      <form noValidate onSubmit={form.onSubmit} className="grid gap-5">
        <PasswordField
          label={t('auth.reset.newPassword')}
          value={form.values.password}
          onValueChange={(value) => form.setValue('password', value)}
          onBlur={(event) => form.onBlur('password', event)}
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
        <Button type="submit" size="lg" fullWidth loading={form.submitting} className="mt-1">
          {form.submitting ? t('auth.reset.submitting') : t('auth.reset.submit')}
        </Button>
      </form>
    </div>
  );
}
