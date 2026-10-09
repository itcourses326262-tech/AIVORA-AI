'use client';

import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { failureText } from '@/components/account/form-errors';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { api } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';

export interface SetPasswordPromptProps {
  /** What the person came to do; picks the sentence that explains why a password is needed first. */
  purpose: 'change' | 'delete';
}

/**
 * For an account that signs in with Google and has no password: says so, and offers the only way to
 * get one, the existing "forgot password" email (completing it sets a real password). Used where a
 * password would otherwise be asked for: changing it, and confirming the deletion of the account.
 */
export function SetPasswordPrompt({ purpose }: SetPasswordPromptProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { user } = useUser();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (sending || !user) return;
    setSending(true);
    setError(null);
    try {
      await api.post('/auth/password/forgot', { email: user.email });
      setSent(true);
    } catch (failure) {
      setError(failureText(failure, i18n));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid max-w-xl gap-4">
      <p className="text-sm leading-6 text-muted">
        {t(purpose === 'delete' ? 'auth.setPassword.deleteNote' : 'auth.setPassword.changeNote')}
      </p>
      <FormError>{error}</FormError>
      {sent ? (
        <p
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success-soft px-3.5 py-3 text-sm text-success"
        >
          <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {t('auth.setPassword.sent', { email: user?.email ?? '' })}
          </span>
        </p>
      ) : (
        <div>
          <Button variant="secondary" loading={sending} onClick={() => void send()}>
            {sending ? t('auth.setPassword.sending') : t('auth.setPassword.button')}
          </Button>
        </div>
      )}
    </div>
  );
}
