'use client';

import { useCallback } from 'react';
import { isolateLtr } from '@/components/auth/bidi';
import { useResendVerification } from '@/components/layout/verify-email-banner';
import { creditsLabel } from '@/components/marketing/credits-label';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { Notice } from './notice';

/** The notice the checkout buttons point at (`aria-describedby`) while they are off. */
export const CONFIRM_EMAIL_NOTICE_ID = 'pricing-confirm-email';

/**
 * Shown on the price list to a signed-in account that has not confirmed its email address while the
 * server requires it: buying is refused by the API (`email_not_verified`) until then, and credits
 * bought now could not be used, so the page says so politely, with the way to get a new link,
 * instead of letting the buyer press a button and meet an error.
 */
export function ConfirmEmailNotice() {
  const i18n = useI18n();
  const { t } = i18n;
  const { user, refresh } = useUser();
  const onVerified = useCallback(() => void refresh(), [refresh]);
  const { remaining, busy, resend, label } = useResendVerification(onVerified);
  if (!user) return null;
  const bonus = user.pendingBonusCredits ?? 0;
  return (
    <div id={CONFIRM_EMAIL_NOTICE_ID}>
      <Notice
        tone="warning"
        role="status"
        title={t('billing.pricing.confirmEmail.title')}
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            disabled={remaining > 0}
            onClick={resend}
          >
            {label}
          </Button>
        }
      >
        {t('billing.pricing.confirmEmail.body', { email: isolateLtr(user.email) })}
        {bonus > 0
          ? ` ${t('billing.pricing.confirmEmail.bonus', { credits: creditsLabel(i18n, bonus) })}`
          : ''}
      </Notice>
    </div>
  );
}
