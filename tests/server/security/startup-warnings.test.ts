import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv, resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';

const SECRET = 'a-production-grade-secret-0123456789abcdef0123';

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  resetLoggerForTests();
});

/** The warnings `getEnv()` writes the first time it runs, as { msg } objects. */
function warningsFor(values: Record<string, string>): string[] {
  // Start from the defaults whatever the developer's shell has set.
  for (const key of ['ADMIN_EMAILS', 'RATE_LIMIT_DISABLED', 'TRUST_PROXY']) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  vi.stubEnv('LOG_LEVEL', 'warn');
  resetEnvForTests();
  resetLoggerForTests();
  vi.restoreAllMocks(); // a fresh spy: this helper may run twice in one test
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  getEnv();
  getEnv(); // the second call must be silent
  return write.mock.calls.map(([chunk]) => (JSON.parse(String(chunk)) as { msg: string }).msg);
}

describe('start-up warnings about risky settings', () => {
  it('stays quiet with the defaults', () => {
    expect(warningsFor({ NODE_ENV: 'development', SESSION_SECRET: SECRET })).toEqual([]);
  });

  it('warns that ADMIN_EMAILS addresses become admins without email verification', () => {
    const messages = warningsFor({
      NODE_ENV: 'development',
      SESSION_SECRET: SECRET,
      ADMIN_EMAILS: 'boss@example.com,other@example.com',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/ADMIN_EMAILS/);
    expect(messages[0]).toMatch(/not verified/);
    expect(messages[0]).not.toMatch(/boss@example\.com/); // the addresses themselves stay out of the log
  });

  it('warns once, loudly, about RATE_LIMIT_DISABLED', () => {
    const messages = warningsFor({
      NODE_ENV: 'development',
      SESSION_SECRET: SECRET,
      RATE_LIMIT_DISABLED: 'true',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/RATE_LIMIT_DISABLED=true/);
    expect(messages[0]).toMatch(/OFF/);
  });

  it('warns in production when the proxy is not trusted (all visitors share one bucket)', () => {
    const messages = warningsFor({ NODE_ENV: 'production', SESSION_SECRET: SECRET });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/TRUST_PROXY=false/);
    expect(
      warningsFor({ NODE_ENV: 'production', SESSION_SECRET: SECRET, TRUST_PROXY: 'true' }),
    ).toEqual([]);
  });

  it('collects several warnings, each once', () => {
    const messages = warningsFor({
      NODE_ENV: 'production',
      SESSION_SECRET: SECRET,
      ADMIN_EMAILS: 'boss@example.com',
      RATE_LIMIT_DISABLED: 'true',
    });
    expect(messages).toHaveLength(3);
  });
});
