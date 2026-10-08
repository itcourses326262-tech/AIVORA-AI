'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/billing/format';
import type { BillingMode } from '@/lib/billing/types';
import type { BillingPlanDTO } from '@/lib/api-types';
import { creditsLabel } from '@/components/marketing/credits-label';
import { useI18n } from '@/lib/i18n/client';

export interface SubscribeDialogProps {
  /** The plan being confirmed; the dialog is closed while this is null. */
  plan: BillingPlanDTO | null;
  /** Days before a month ends when its renewal payment link appears. */
  leadDays: number;
  gateway: BillingMode;
  onConfirm: (plan: BillingPlanDTO) => void;
  onClose: () => void;
}

/**
 * Asked before a subscription starts: price, what is received, how it renews and how to stop it.
 * Nothing about a plan is hidden in the fine print of a later page.
 */
export function SubscribeDialog({
  plan,
  leadDays,
  gateway,
  onConfirm,
  onClose,
}: SubscribeDialogProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  // The last plan stays rendered while the dialog animates out.
  const [shown, setShown] = useState(plan);
  if (plan !== null && plan !== shown) setShown(plan);
  return (
    <Dialog
      open={plan !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('billing.confirm.title', { plan: shown?.name[locale] ?? '' })}
      description={t('billing.confirm.description')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('billing.confirm.dismiss')}
          </Button>
          <Button data-autofocus onClick={() => shown && onConfirm(shown)}>
            {t('billing.confirm.continue')}
          </Button>
        </>
      }
    >
      {shown ? (
        <div className="grid gap-4">
          <dl className="grid gap-4 text-sm">
            <div className="grid gap-0.5">
              <dt className="font-medium text-foreground">{t('billing.confirm.price')}</dt>
              <dd className="text-muted">
                {t('billing.confirm.priceValue', {
                  price: formatMoney(shown.priceHalalas, locale),
                })}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="font-medium text-foreground">{t('billing.confirm.credits')}</dt>
              <dd className="text-muted">
                {t('billing.confirm.creditsValue', {
                  credits: creditsLabel(i18n, shown.monthlyCredits),
                })}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="font-medium text-foreground">{t('billing.confirm.renewal')}</dt>
              <dd className="text-muted">
                {t('billing.confirm.renewalValue', { days: leadDays })}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="font-medium text-foreground">{t('billing.confirm.cancel')}</dt>
              <dd className="text-muted">{t('billing.confirm.cancelValue')}</dd>
            </div>
          </dl>
          {gateway === 'mock' ? (
            <p className="text-xs text-warning">{t('billing.confirm.mock')}</p>
          ) : (
            <p className="text-xs text-subtle">{t('billing.confirm.secure')}</p>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
