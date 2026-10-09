import 'server-only';
import { getEnv, type Env } from '@/server/env';
import { getLogger } from '@/server/logger';
import { outboxTransport } from './outbox';
import { createSmtpTransport, smtpSettingsFromEnv } from './smtp';
import type { EmailTransport } from './types';

/** Used as the `From` header while EMAIL_FROM is unset, which is only possible without SMTP. */
export const DEFAULT_FROM = 'AIVORE <no-reply@aivore.local>';

const CACHE_KEY = Symbol.for('aivore.email.transport');
type GlobalWithTransport = typeof globalThis & {
  [CACHE_KEY]?: { signature: string; transport: EmailTransport };
};

let override: EmailTransport | null = null;
let warnedAboutOutbox = false;

/** Tests inject a fake transport here; `null` restores the configured one. */
export function setEmailTransportOverride(transport: EmailTransport | null): void {
  override = transport;
}

/** True when SMTP_URL or SMTP_HOST is set, i.e. mail really leaves the machine. */
export function isSmtpConfigured(env: Pick<Env, 'SMTP_URL' | 'SMTP_HOST'> = getEnv()): boolean {
  return Boolean(env.SMTP_URL || env.SMTP_HOST);
}

export function emailFrom(env: Pick<Env, 'EMAIL_FROM'> = getEnv()): string {
  return env.EMAIL_FROM ?? DEFAULT_FROM;
}

/**
 * SMTP when configured, otherwise the outbox, so the whole account flow works on a laptop with no
 * configuration. The SMTP transport is created once per distinct configuration and kept on
 * `globalThis` (Next.js dev HMR re-evaluates modules).
 */
export function getEmailTransport(): EmailTransport {
  if (override) return override;
  const env = getEnv();
  const settings = smtpSettingsFromEnv(env);
  if (!settings) {
    if (env.NODE_ENV === 'production' && !warnedAboutOutbox) {
      warnedAboutOutbox = true;
      getLogger().warn(
        'SMTP is not configured: verification and password-reset emails are NOT being sent, and neither are billing emails (payment receipts, renewal links, overdue and expiry notices, refund notices); they are only written to the outbox file. Set SMTP_URL and EMAIL_FROM.',
        { component: 'email' },
      );
    }
    return outboxTransport;
  }
  // The signature includes the credentials so a changed password rebuilds the transport; it is
  // compared in memory and never logged.
  const signature = JSON.stringify(settings);
  const scope = globalThis as GlobalWithTransport;
  const cached = scope[CACHE_KEY];
  if (cached?.signature === signature) return cached.transport;
  const transport = createSmtpTransport(settings);
  scope[CACHE_KEY] = { signature, transport };
  return transport;
}
