import 'server-only';
import { isSmtpConfigured } from '@/server/email';
import { getEnv } from '@/server/env';
import type { Logger } from '@/server/logger';
import { registerBillingAccountHook } from './account';
import { getBillingMode } from './config';
import { startBillingScheduler } from './scheduler';

/**
 * Starts billing in this process, from `instrumentation.ts`:
 *  - the account-deletion hook, in every case (a deleted account must never keep a subscription or
 *    a payable checkout, whether or not this process runs background work or sells right now);
 *  - the background work (renewal links, reconciliation of unpaid checkouts, re-checking paid
 *    orders for refunds), not with `WORKER_MODE=off` (tests, tools that must not do background
 *    work) and not while billing is switched off. Starting it in several processes is fine
 *    (`scheduler.ts` claims every unit of work).
 * Returns whether the background work was started. Settings that make real money unsafe are
 * reported loudly here, once, because nothing else would notice them.
 */
export function bootBillingScheduler(log: Logger): boolean {
  registerBillingAccountHook();
  const env = getEnv();
  if (env.WORKER_MODE === 'off') return false;
  const gateway = getBillingMode(env);
  if (gateway === 'off') return false;
  if (gateway === 'moyasar') warnAboutRiskySettings(log, env);
  startBillingScheduler();
  log.info('Billing scheduler started', { gateway });
  return true;
}

function warnAboutRiskySettings(log: Logger, env: ReturnType<typeof getEnv>): void {
  if (!env.MOYASAR_WEBHOOK_SECRET) {
    log.error(
      'MOYASAR_WEBHOOK_SECRET is not set: every Moyasar webhook is rejected. Payments are still confirmed within about a minute, but a refund or chargeback is only noticed by the periodic re-check of paid orders (every few hours), so credits stay with the buyer longer than they should. Set it and register the webhook in the Moyasar dashboard.',
    );
  }
  if (!isSmtpConfigured(env)) {
    log.error(
      'SMTP is not configured while billing is on: payment receipts, renewal links, overdue and expiry notices and refund notices are only written to the outbox file, so subscribers are never told when to pay and a plan can lapse unnoticed. Set SMTP_URL and EMAIL_FROM.',
    );
  }
  if (env.NODE_ENV === 'production' && !env.TRUST_PROXY) {
    log.error(
      'TRUST_PROXY is false while billing is on: every caller shares one address, so a flood of junk requests to the webhook and return URLs can crowd out the payment gateway and paying buyers (they get 429). Set TRUST_PROXY=true behind a reverse proxy.',
    );
  }
}
