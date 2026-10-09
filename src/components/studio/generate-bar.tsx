'use client';

import { Coins, LogIn, Sparkles, TriangleAlert } from 'lucide-react';
import { useSyncExternalStore, type MouseEvent } from 'react';
import { creditsText } from '@/lib/generations/format';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatCredits } from '@/lib/utils';
import { Button } from '../ui/button';
import { Kbd } from '../ui/kbd';
import { PRICING_HREF, isShort, type CreditStatus } from './credits';

export interface CreditNoticeProps {
  status: CreditStatus;
  /** Where "Log in" leads once the session has ended (back to this studio). */
  loginHref?: string;
  className?: string;
}

/**
 * Says what is missing and links to the page that sells it. Renders nothing when affordable. After
 * the session ended it says so instead, and links to the login page.
 */
export function CreditNotice({ status, loginHref, className }: CreditNoticeProps) {
  const i18n = useI18n();
  const { t } = i18n;
  if (status.signedOut) {
    return (
      <div
        role="status"
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-warning/35 bg-warning-soft px-3 py-2.5',
          className,
        )}
      >
        <p className="flex items-center gap-2 text-sm text-foreground">
          <LogIn aria-hidden="true" className="size-4 shrink-0 text-warning" />
          {t('studio.submit.sessionExpired')}
        </p>
        <Button href={loginHref ?? '/login'} size="sm" variant="secondary">
          {t('common.nav.login')}
        </Button>
      </div>
    );
  }
  if (!isShort(status) || status.cost === null) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-warning/35 bg-warning-soft px-3 py-2.5',
        className,
      )}
    >
      <p className="flex items-center gap-2 text-sm text-foreground">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
        {t('errors.insufficient_credits')}{' '}
        {t('studio.cost.short', { missing: creditsText(i18n, status.cost - status.balance) })}
      </p>
      <Button href={PRICING_HREF} size="sm" variant="secondary">
        {t('studio.cost.getCredits')}
      </Button>
    </div>
  );
}

const noSubscription = () => () => {};

/** ⌘ on Apple devices, Ctrl elsewhere. The server render says Ctrl; the browser corrects it. */
function useShortcutModifier(): string {
  return useSyncExternalStore(
    noSubscription,
    () => (/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  );
}

export interface GenerateButtonProps extends CreditStatus {
  busy: boolean;
  /** No model can run this tool (or the catalog has not loaded). */
  noModel: boolean;
  onGenerate: (event: MouseEvent<HTMLButtonElement>) => void;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
}

export function GenerateButton({
  cost,
  balance,
  signedOut,
  busy,
  noModel,
  onGenerate,
  size = 'lg',
  fullWidth = true,
}: GenerateButtonProps) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <Button
      size={size}
      fullWidth={fullWidth}
      loading={busy}
      disabled={noModel || cost === null || isShort({ cost, balance, signedOut })}
      startIcon={busy ? undefined : <Sparkles aria-hidden="true" />}
      onClick={onGenerate}
    >
      {busy
        ? t('studio.action.starting')
        : cost === null
          ? t('studio.generate')
          : t('studio.action.generate', { price: creditsText(i18n, cost) })}
    </Button>
  );
}

export interface GenerateBarProps extends GenerateButtonProps {
  loginHref?: string;
  className?: string;
}

/** Cost, balance, the "get credits" way out and the Generate button, pinned under the controls. */
export function GenerateBar({ className, loginHref, ...button }: GenerateBarProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const modifier = useShortcutModifier();
  const { cost, balance, signedOut } = button;
  return (
    <div className={cn('grid gap-3 border-t border-border bg-surface p-4', className)}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="flex items-center gap-2 text-muted">
          <Coins aria-hidden="true" className="size-4 text-brand" />
          <span>{t('studio.cost.label')}</span>
          <strong className="font-semibold text-foreground tabular-nums">
            {cost === null ? '—' : creditsText(i18n, cost)}
          </strong>
        </p>
        <p className="text-muted tabular-nums">
          {t('studio.cost.balance', { balance: signedOut ? '—' : formatCredits(balance, locale) })}
        </p>
      </div>
      <CreditNotice status={{ cost, balance, signedOut }} loginHref={loginHref} />
      {cost === null && !button.noModel ? (
        <p role="status" className="text-sm text-warning">
          {t('studio.cost.unavailable')}
        </p>
      ) : null}
      <GenerateButton {...button} />
      <p className="hidden items-center justify-center gap-1.5 text-xs text-subtle lg:flex">
        <span dir="ltr" className="inline-flex items-center gap-1">
          <Kbd>{modifier}</Kbd>
          <Kbd>Enter</Kbd>
        </span>
        <span>{t('studio.prompt.shortcut')}</span>
      </p>
    </div>
  );
}
