import 'server-only';
import {
  billingConfigProblems,
  resolveBillingMode,
  type NodeEnvironment,
} from '@/lib/billing/gateway-config';
import type { BillingMode } from '@/lib/billing/types';
import { AppError } from '@/lib/errors';
import { getEnv, type Env } from '@/server/env';
import { getLogger } from '@/server/logger';
import type { BillingGateway } from './gateway';
import { getMockGateway } from './mock';
import { BillingConfigError, createMoyasarGateway } from './moyasar';

/** Which backend runs now, from the validated environment. */
export function getBillingMode(env: Env = getEnv()): BillingMode {
  return resolveBillingMode(env.NODE_ENV, env.BILLING_GATEWAY, Boolean(env.MOYASAR_SECRET_KEY));
}

// Tests install a gateway wired to a stub `fetch`; the application never sets one.
const OVERRIDE_KEY = Symbol.for('aivore.billingGatewayOverride');
type GlobalWithOverride = typeof globalThis & { [OVERRIDE_KEY]?: BillingGateway };

/** Replaces the configured gateway (tests only). `null` restores the configured one. */
export function setGatewayOverride(gateway: BillingGateway | null): void {
  (globalThis as GlobalWithOverride)[OVERRIDE_KEY] = gateway ?? undefined;
}

function billingOff(): AppError {
  return new AppError('provider_error', 503, 'Billing is not available right now', {
    reason: 'billing_disabled',
  });
}

/**
 * The gateway to talk to, or a 503 `billing_disabled` error when billing is switched off. Unsafe
 * settings (a live key in development, a mock in production) throw `BillingConfigError`.
 */
export function getGateway(env: Env = getEnv()): BillingGateway {
  const override = (globalThis as GlobalWithOverride)[OVERRIDE_KEY];
  if (override) return override;

  const mode = getBillingMode(env);
  if (mode === 'off') throw billingOff();
  if (mode === 'mock') {
    // `resolveBillingMode` cannot return this in production; the check is repeated on purpose.
    if (process.env.NODE_ENV === 'production') {
      throw new BillingConfigError('The mock billing gateway cannot be used in production');
    }
    return getMockGateway();
  }

  const problems = billingConfigProblems({
    nodeEnv: env.NODE_ENV as NodeEnvironment,
    gateway: env.BILLING_GATEWAY,
    secretKey: env.MOYASAR_SECRET_KEY,
    publishableKey: env.MOYASAR_PUBLISHABLE_KEY,
    webhookSecret: env.MOYASAR_WEBHOOK_SECRET,
    allowLiveInDev: env.MOYASAR_ALLOW_LIVE_IN_DEV,
    allowTestInProduction: env.MOYASAR_ALLOW_TEST_IN_PRODUCTION,
  });
  if (problems.length > 0 || !env.MOYASAR_SECRET_KEY) {
    throw new BillingConfigError(`Unsafe billing configuration: ${problems.join('; ')}`);
  }
  if (!env.MOYASAR_WEBHOOK_SECRET) warnWebhooksDisabledOnce();
  return createMoyasarGateway({
    secretKey: env.MOYASAR_SECRET_KEY,
    apiBase: env.MOYASAR_API_BASE,
    webhookSecret: env.MOYASAR_WEBHOOK_SECRET,
    nodeEnv: env.NODE_ENV as NodeEnvironment,
    allowLiveInDev: env.MOYASAR_ALLOW_LIVE_IN_DEV,
  });
}

let warned = false;
function warnWebhooksDisabledOnce(): void {
  if (warned) return;
  warned = true;
  getLogger().warn(
    'MOYASAR_WEBHOOK_SECRET is not set: every webhook is rejected. Payments are still confirmed when the buyer returns and by the background reconciliation, but only within a minute or so of the payment.',
  );
}

/** True when buying is possible (a gateway is configured), without constructing it. */
export function isBillingEnabled(env: Env = getEnv()): boolean {
  return (
    (globalThis as GlobalWithOverride)[OVERRIDE_KEY] !== undefined || getBillingMode(env) !== 'off'
  );
}
