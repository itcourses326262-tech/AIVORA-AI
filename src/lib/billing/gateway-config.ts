import type { BillingGatewaySetting, BillingMode } from './types';

/**
 * Which payment backend runs, and whether the keys we were given are allowed to run here. Pure
 * functions of plain values (no environment access), so `server/env.ts` can use them while it
 * parses and the tests can sweep every combination. The decisions that guard real money live in
 * this one file.
 */

export type NodeEnvironment = 'development' | 'production' | 'test';

/**
 * `auto`: production uses Moyasar when a secret key exists and is OFF otherwise; development and
 * test use the in-process fake. The fake can NEVER be selected in production: an explicit `mock`
 * there resolves to `off` (and `billingConfigProblems` reports it), so no combination of settings
 * can make production accept a pretend payment.
 */
export function resolveBillingMode(
  nodeEnv: NodeEnvironment,
  setting: BillingGatewaySetting,
  hasSecretKey: boolean,
): BillingMode {
  switch (setting) {
    case 'off':
      return 'off';
    case 'mock':
      return nodeEnv === 'production' ? 'off' : 'mock';
    case 'moyasar':
      return 'moyasar';
    case 'auto':
      if (nodeEnv === 'production') return hasSecretKey ? 'moyasar' : 'off';
      return 'mock';
  }
}

export type MoyasarKeyMode = 'live' | 'test';

const SECRET_KEY = /^sk_(live|test)_[A-Za-z0-9]{8,}$/;
const PUBLISHABLE_KEY = /^pk_(live|test)_[A-Za-z0-9]{8,}$/;

/** `live` or `test` for a well-formed Moyasar key of the given kind, otherwise null. */
export function moyasarKeyMode(key: string, kind: 'secret' | 'publishable'): MoyasarKeyMode | null {
  const match = (kind === 'secret' ? SECRET_KEY : PUBLISHABLE_KEY).exec(key);
  return match ? (match[1] as MoyasarKeyMode) : null;
}

export const MIN_WEBHOOK_SECRET_CHARS = 16;

export interface BillingConfigSource {
  nodeEnv: NodeEnvironment;
  gateway: BillingGatewaySetting;
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
  allowLiveInDev: boolean;
  allowTestInProduction: boolean;
}

/**
 * Everything wrong with the billing settings, as sentences for `EnvError`. Key values are never
 * quoted. A live key sitting unused in `.env.local` is fine while the fake gateway is selected,
 * because nothing then ever reads it; the rules bite when Moyasar is the gateway that would run.
 */
export function billingConfigProblems(source: BillingConfigSource): string[] {
  const problems: string[] = [];
  const mode = resolveBillingMode(source.nodeEnv, source.gateway, Boolean(source.secretKey));

  if (source.gateway === 'mock' && source.nodeEnv === 'production') {
    problems.push(
      'BILLING_GATEWAY: "mock" is a pretend payment page and is not allowed in production; use "moyasar" or "off"',
    );
  }
  if (
    source.webhookSecret !== undefined &&
    source.webhookSecret.length < MIN_WEBHOOK_SECRET_CHARS
  ) {
    problems.push(
      `MOYASAR_WEBHOOK_SECRET: must be at least ${MIN_WEBHOOK_SECRET_CHARS} characters (generate one with: openssl rand -hex 24)`,
    );
  }
  if (mode !== 'moyasar') return problems;

  if (source.secretKey === undefined) {
    problems.push('MOYASAR_SECRET_KEY: is required when BILLING_GATEWAY=moyasar');
    return problems;
  }
  const secretMode = moyasarKeyMode(source.secretKey, 'secret');
  if (secretMode === null) {
    problems.push('MOYASAR_SECRET_KEY: must look like sk_test_… or sk_live_… (the secret key)');
  }
  const publishableMode =
    source.publishableKey === undefined
      ? undefined
      : moyasarKeyMode(source.publishableKey, 'publishable');
  if (publishableMode === null) {
    problems.push('MOYASAR_PUBLISHABLE_KEY: must look like pk_test_… or pk_live_…');
  }
  if (secretMode && publishableMode && secretMode !== publishableMode) {
    problems.push(
      'MOYASAR_PUBLISHABLE_KEY: is a different mode (test/live) than MOYASAR_SECRET_KEY',
    );
  }

  const modes = [secretMode, publishableMode];
  if (source.nodeEnv !== 'production' && modes.includes('live') && !source.allowLiveInDev) {
    problems.push(
      'MOYASAR_SECRET_KEY / MOYASAR_PUBLISHABLE_KEY: live keys are refused outside production, because a test or development run would take real money. Use sk_test_/pk_test_ keys, or set MOYASAR_ALLOW_LIVE_IN_DEV=true if you really mean it',
    );
  }
  if (source.nodeEnv === 'production' && modes.includes('test') && !source.allowTestInProduction) {
    problems.push(
      'MOYASAR_SECRET_KEY / MOYASAR_PUBLISHABLE_KEY: test keys are refused in production, because test cards would then buy real credits for free. Use live keys, or set MOYASAR_ALLOW_TEST_IN_PRODUCTION=true for a staging deployment',
    );
  }
  return problems;
}
