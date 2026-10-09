import 'server-only';
import type { Locale } from '@/lib/i18n/locales';
import { appLink, queueEmail, renderEmail } from '@/server/email';
import { TOKEN_TTL_MS } from './email-tokens';

/** Who an email goes to: the address as typed at registration, the name and the language. */
export interface Recipient {
  email: string;
  name: string;
  locale: Locale;
}

const HOUR_MS = 60 * 60 * 1000;

/** Queues the confirmation link. `bonusCredits` > 0 adds "confirming gives you N free credits". */
export function queueVerificationEmail(
  to: Recipient,
  secret: string,
  bonusCredits: number = 0,
): void {
  queueEmail(
    renderEmail({
      kind: 'verification',
      locale: to.locale,
      to: to.email,
      name: to.name,
      link: appLink('/verify-email', { token: secret }),
      ttlHours: TOKEN_TTL_MS.verify / HOUR_MS,
      bonusCredits,
    }),
  );
}

export function queuePasswordResetEmail(to: Recipient, secret: string): void {
  queueEmail(
    renderEmail({
      kind: 'password_reset',
      locale: to.locale,
      to: to.email,
      name: to.name,
      link: appLink('/reset-password', { token: secret }),
      ttlHours: TOKEN_TTL_MS.reset / HOUR_MS,
    }),
  );
}

/**
 * The notice after a reset: "if this was not you, start another reset". `keysRevoked` > 0 adds a
 * line saying the account's API keys were revoked too.
 */
export function queuePasswordChangedEmail(
  to: Recipient,
  at: number = Date.now(),
  keysRevoked: number = 0,
): void {
  queueEmail(
    renderEmail({
      kind: 'password_changed',
      locale: to.locale,
      to: to.email,
      name: to.name,
      link: appLink('/forgot-password'),
      at,
      keysRevoked,
    }),
  );
}

export function queueWelcomeEmail(to: Recipient, bonusCredits: number = 0): void {
  queueEmail(
    renderEmail({
      kind: 'welcome',
      locale: to.locale,
      to: to.email,
      name: to.name,
      link: appLink('/studio'),
      bonusCredits,
    }),
  );
}

export function queueAccountDeletedEmail(to: Recipient): void {
  queueEmail(
    renderEmail({
      kind: 'account_deleted',
      locale: to.locale,
      to: to.email,
      name: to.name,
    }),
  );
}
