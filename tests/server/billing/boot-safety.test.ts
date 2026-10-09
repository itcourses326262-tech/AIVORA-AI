import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootBillingScheduler } from '@/server/billing/boot';
import { stopBillingScheduler } from '@/server/billing/scheduler';
import { resetEnvForTests } from '@/server/env';
import { createLogger } from '@/server/logger';

const LIVE_KEY = 'sk_live_' + 'AbCdEfGhIjKlMnOpQrStUvWx';

function capture() {
  const lines: Array<{ level: string; line: string }> = [];
  const log = createLogger({
    level: 'debug',
    sink: (level, line) => lines.push({ level, line }),
  });
  return { log, lines, errors: () => lines.filter((entry) => entry.level === 'error') };
}

/** Real mail: without it the other warnings are the only thing a test wants to look at. */
const SMTP = {
  SMTP_URL: 'smtp://mail.example.com:587',
  EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
} as const;

function productionWithMoyasar(extra: Record<string, string> = {}, { smtp = true } = {}) {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('SESSION_SECRET', 'a-long-production-secret-of-more-than-32-chars');
  vi.stubEnv('APP_URL', 'https://aivore.example');
  vi.stubEnv('WORKER_MODE', 'inline');
  vi.stubEnv('BILLING_GATEWAY', 'moyasar');
  vi.stubEnv('MOYASAR_SECRET_KEY', LIVE_KEY);
  if (smtp) {
    for (const [key, value] of Object.entries(SMTP)) vi.stubEnv(key, value);
  }
  for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value);
  resetEnvForTests();
}

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'silent');
});
afterEach(async () => {
  await stopBillingScheduler();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe('billing start-up says it loudly when real money is at risk', () => {
  it('no webhook secret: refunds and chargebacks are only found by the periodic re-check', () => {
    productionWithMoyasar({ TRUST_PROXY: 'true' });
    const { log, errors } = capture();

    expect(bootBillingScheduler(log)).toBe(true);

    const messages = errors().map((entry) => entry.line);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('MOYASAR_WEBHOOK_SECRET is not set');
    expect(messages[0]).toContain('refund or chargeback');
    expect(messages[0]).not.toContain(LIVE_KEY);
  });

  it('no trusted proxy: the shared address budget can crowd out the gateway and the buyers', () => {
    productionWithMoyasar({ MOYASAR_WEBHOOK_SECRET: 'whsec-0123456789abcdef0123456789' });
    const { log, errors } = capture();

    expect(bootBillingScheduler(log)).toBe(true);

    const messages = errors().map((entry) => entry.line);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('TRUST_PROXY is false');
  });

  it('no SMTP: receipts, renewal links and reminders would go to the outbox file and subscribers would miss their renewals', () => {
    productionWithMoyasar(
      { MOYASAR_WEBHOOK_SECRET: 'whsec-0123456789abcdef0123456789', TRUST_PROXY: 'true' },
      { smtp: false },
    );
    const { log, errors } = capture();

    expect(bootBillingScheduler(log)).toBe(true);

    const messages = errors().map((entry) => entry.line);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('SMTP is not configured while billing is on');
    expect(messages[0]).toContain('renewal links');
    expect(messages[0]).toContain('SMTP_URL');
    expect(messages[0]).not.toContain(LIVE_KEY);
  });

  it('separate SMTP_HOST settings count as configured too', () => {
    productionWithMoyasar(
      {
        MOYASAR_WEBHOOK_SECRET: 'whsec-0123456789abcdef0123456789',
        TRUST_PROXY: 'true',
        SMTP_HOST: 'mail.example.com',
        EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
      },
      { smtp: false },
    );
    const { log, errors } = capture();

    expect(bootBillingScheduler(log)).toBe(true);
    expect(errors()).toEqual([]);
  });

  it('every missing piece is reported on its own line', () => {
    productionWithMoyasar({}, { smtp: false });
    const { log, errors } = capture();

    bootBillingScheduler(log);

    const messages = errors().map((entry) => entry.line);
    expect(messages).toHaveLength(3);
    expect(messages.join('\n')).toMatch(/MOYASAR_WEBHOOK_SECRET[\s\S]*SMTP[\s\S]*TRUST_PROXY/);
  });

  it('a safe setup starts quietly', () => {
    productionWithMoyasar({
      MOYASAR_WEBHOOK_SECRET: 'whsec-0123456789abcdef0123456789',
      TRUST_PROXY: 'true',
    });
    const { log, errors, lines } = capture();

    expect(bootBillingScheduler(log)).toBe(true);

    expect(errors()).toEqual([]);
    expect(lines.some((entry) => entry.line.includes('Billing scheduler started'))).toBe(true);
  });

  it('the development fake gateway raises no alarm, mail or not', () => {
    vi.stubEnv('WORKER_MODE', 'inline');
    resetEnvForTests();
    const { log, errors } = capture();

    expect(bootBillingScheduler(log)).toBe(true);
    expect(errors()).toEqual([]);
  });
});
