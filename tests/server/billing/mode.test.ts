import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  billingConfigProblems,
  resolveBillingMode,
  type BillingConfigSource,
  type NodeEnvironment,
} from '@/lib/billing/gateway-config';
import { BILLING_GATEWAY_SETTINGS } from '@/lib/billing/types';
import { getBillingMode, getGateway, setGatewayOverride } from '@/server/billing/config';
import {
  assertMockAllowed,
  createMockGateway,
  getMockGateway,
  resetMockGatewayForTests,
} from '@/server/billing/mock';
import { EnvError, getEnv, parseEnv, resetEnvForTests } from '@/server/env';

afterEach(() => {
  vi.unstubAllEnvs();
  setGatewayOverride(null);
  resetMockGatewayForTests();
  resetEnvForTests();
});

const LIVE_SECRET = 'sk_live_' + 'AbCdEfGhIjKlMnOpQrStUvWx';
const LIVE_PUBLISHABLE = 'pk_live_' + 'AbCdEfGhIjKlMnOpQrStUvWx';
const TEST_SECRET = 'sk_test_' + 'AbCdEfGhIjKlMnOpQrStUvWx';
const TEST_PUBLISHABLE = 'pk_test_' + 'AbCdEfGhIjKlMnOpQrStUvWx';

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv({ SESSION_SECRET: 'x'.repeat(40), ...source });
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  return [];
}

describe('which gateway runs', () => {
  const environments: NodeEnvironment[] = ['development', 'production', 'test'];

  it('the fake gateway can never be selected in production, whatever the settings', () => {
    for (const setting of BILLING_GATEWAY_SETTINGS) {
      for (const hasKey of [true, false]) {
        expect(
          resolveBillingMode('production', setting, hasKey),
          `${setting} key=${hasKey}`,
        ).not.toBe('mock');
      }
    }
    expect(resolveBillingMode('production', 'mock', true)).toBe('off');
  });

  it.each([
    ['development', 'auto', false, 'mock'],
    ['development', 'auto', true, 'mock'],
    ['test', 'auto', false, 'mock'],
    ['production', 'auto', true, 'moyasar'],
    ['production', 'auto', false, 'off'],
    ['production', 'moyasar', true, 'moyasar'],
    ['development', 'moyasar', true, 'moyasar'],
    ['development', 'mock', false, 'mock'],
    ['development', 'off', true, 'off'],
    ['production', 'off', true, 'off'],
  ] as const)('%s + %s (key: %s) -> %s', (nodeEnv, setting, hasKey, expected) => {
    expect(resolveBillingMode(nodeEnv, setting, hasKey)).toBe(expected);
  });

  it('every environment resolves to something', () => {
    for (const env of environments) {
      for (const setting of BILLING_GATEWAY_SETTINGS) {
        expect(['mock', 'moyasar', 'off']).toContain(resolveBillingMode(env, setting, false));
      }
    }
  });

  it('parseEnv refuses BILLING_GATEWAY=mock in production', () => {
    expect(problemsOf({ NODE_ENV: 'production', BILLING_GATEWAY: 'mock' }).join('\n')).toMatch(
      /not allowed in production/,
    );
    expect(problemsOf({ NODE_ENV: 'development', BILLING_GATEWAY: 'mock' })).toEqual([]);
  });

  it('the mock gateway refuses to be built in production, however it is reached', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertMockAllowed()).toThrow(/cannot be used in production/);
    expect(() => createMockGateway({ appUrl: 'https://x.example' })).toThrow(/production/);
    expect(() => getMockGateway()).toThrow(/production/);
  });

  it('getGateway has no way to return the fake in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BILLING_GATEWAY', 'mock');
    // The environment itself is invalid ...
    expect(() => getEnv()).toThrow(EnvError);
    // ... and even a hand-built, otherwise valid environment cannot select it.
    const env = {
      ...parseEnv({ SESSION_SECRET: 'x'.repeat(40), NODE_ENV: 'production' }),
      BILLING_GATEWAY: 'mock' as const,
    };
    expect(getBillingMode(env)).toBe('off');
    expect(() => getGateway(env)).toThrow(
      expect.objectContaining({ code: 'provider_error', status: 503 }),
    );
  });

  it('billing is off in production until a key is configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const env = parseEnv({ SESSION_SECRET: 'x'.repeat(40), NODE_ENV: 'production' });
    expect(getBillingMode(env)).toBe('off');
    expect(() => getGateway(env)).toThrow(
      expect.objectContaining({ details: { reason: 'billing_disabled' } }),
    );
  });

  it('development defaults to the fake without any configuration', () => {
    vi.stubEnv('NODE_ENV', 'development');
    resetEnvForTests();
    expect(getBillingMode()).toBe('mock');
    expect(getGateway().id).toBe('mock');
  });
});

describe('live and test keys', () => {
  const base = { BILLING_GATEWAY: 'moyasar' };

  it('refuses live keys outside production unless MOYASAR_ALLOW_LIVE_IN_DEV=true', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(problemsOf({ ...base, NODE_ENV, MOYASAR_SECRET_KEY: LIVE_SECRET }).join('\n')).toMatch(
        /live keys are refused/,
      );
      expect(
        problemsOf({
          ...base,
          NODE_ENV,
          MOYASAR_SECRET_KEY: TEST_SECRET,
          MOYASAR_PUBLISHABLE_KEY: LIVE_PUBLISHABLE,
        }).join('\n'),
      ).toMatch(/live keys are refused|different mode/);
    }
    expect(
      problemsOf({
        ...base,
        NODE_ENV: 'development',
        MOYASAR_SECRET_KEY: LIVE_SECRET,
        MOYASAR_PUBLISHABLE_KEY: LIVE_PUBLISHABLE,
        MOYASAR_ALLOW_LIVE_IN_DEV: 'true',
      }),
    ).toEqual([]);
  });

  it('refuses a live PUBLISHABLE key on its own too (the owner keeps one in .env.local)', () => {
    const problems = problemsOf({
      ...base,
      NODE_ENV: 'development',
      MOYASAR_SECRET_KEY: TEST_SECRET,
      MOYASAR_PUBLISHABLE_KEY: LIVE_PUBLISHABLE,
    });
    expect(problems.join('\n')).toMatch(/live keys are refused/);
  });

  it('a live key that nothing uses is not a problem (the fake gateway is selected)', () => {
    expect(
      problemsOf({ NODE_ENV: 'development', MOYASAR_PUBLISHABLE_KEY: LIVE_PUBLISHABLE }),
    ).toEqual([]);
    expect(
      problemsOf({
        NODE_ENV: 'development',
        BILLING_GATEWAY: 'auto',
        MOYASAR_SECRET_KEY: LIVE_SECRET,
      }),
    ).toEqual([]);
    expect(
      problemsOf({
        NODE_ENV: 'development',
        BILLING_GATEWAY: 'off',
        MOYASAR_SECRET_KEY: LIVE_SECRET,
      }),
    ).toEqual([]);
  });

  it('accepts live keys in production and refuses test keys there unless allowed', () => {
    const production = {
      NODE_ENV: 'production',
      MOYASAR_SECRET_KEY: LIVE_SECRET,
      MOYASAR_PUBLISHABLE_KEY: LIVE_PUBLISHABLE,
    };
    expect(problemsOf(production)).toEqual([]);
    expect(problemsOf({ ...production, BILLING_GATEWAY: 'moyasar' })).toEqual([]);
    const testKeys = {
      NODE_ENV: 'production',
      MOYASAR_SECRET_KEY: TEST_SECRET,
      MOYASAR_PUBLISHABLE_KEY: TEST_PUBLISHABLE,
    };
    expect(problemsOf(testKeys).join('\n')).toMatch(/test keys are refused in production/);
    expect(problemsOf({ ...testKeys, MOYASAR_ALLOW_TEST_IN_PRODUCTION: 'true' })).toEqual([]);
  });

  it('refuses mixed modes and malformed keys, without ever quoting a key', () => {
    const mixed = problemsOf({
      NODE_ENV: 'production',
      MOYASAR_SECRET_KEY: LIVE_SECRET,
      MOYASAR_PUBLISHABLE_KEY: TEST_PUBLISHABLE,
      MOYASAR_ALLOW_TEST_IN_PRODUCTION: 'true',
    });
    expect(mixed.join('\n')).toMatch(/different mode/);
    const malformed = problemsOf({
      NODE_ENV: 'production',
      MOYASAR_SECRET_KEY: 'oops',
      MOYASAR_PUBLISHABLE_KEY: 'nope',
    });
    expect(malformed.join('\n')).toMatch(/sk_test_… or sk_live_…/);
    expect(malformed.join('\n')).toMatch(/pk_test_… or pk_live_…/);
    for (const problem of [...mixed, ...malformed]) {
      for (const secret of [LIVE_SECRET, LIVE_PUBLISHABLE, TEST_PUBLISHABLE, 'oops']) {
        expect(problem).not.toContain(secret);
      }
    }
  });

  it('requires a secret key when Moyasar is chosen explicitly, and still reports everything else', () => {
    expect(problemsOf({ BILLING_GATEWAY: 'moyasar' }).join('\n')).toMatch(
      /MOYASAR_SECRET_KEY: is required/,
    );
    const both = problemsOf({
      NODE_ENV: 'development',
      BILLING_GATEWAY: 'moyasar',
      MOYASAR_PUBLISHABLE_KEY: LIVE_PUBLISHABLE,
    }).join('\n');
    expect(both).toMatch(/MOYASAR_SECRET_KEY: is required/);
    expect(both).toMatch(/live keys are refused/);
  });

  it('checks the same rules at gateway creation (a second, independent line of defence)', () => {
    const source: BillingConfigSource = {
      nodeEnv: 'development',
      gateway: 'moyasar',
      secretKey: LIVE_SECRET,
      allowLiveInDev: false,
      allowTestInProduction: false,
    };
    expect(billingConfigProblems(source).join('\n')).toMatch(/live keys are refused/);
    vi.stubEnv('NODE_ENV', 'development');
    const env = {
      ...parseEnv({ SESSION_SECRET: 'x'.repeat(40) }),
      BILLING_GATEWAY: 'moyasar' as const,
      MOYASAR_SECRET_KEY: LIVE_SECRET,
    };
    expect(() => getGateway(env)).toThrow(/Unsafe billing configuration/);
  });
});

describe('the rest of the billing environment', () => {
  it('only talks to moyasar.com over https (outside tests)', () => {
    for (const MOYASAR_API_BASE of [
      'http://api.moyasar.com/v1',
      'https://evil.example/v1',
      'https://moyasar.com.evil.example',
    ]) {
      expect(problemsOf({ NODE_ENV: 'development', MOYASAR_API_BASE }).join('\n')).toMatch(
        /moyasar\.com/,
      );
    }
    expect(
      problemsOf({ NODE_ENV: 'development', MOYASAR_API_BASE: 'https://api.moyasar.com/v1/' }),
    ).toEqual([]);
    expect(problemsOf({ NODE_ENV: 'test', MOYASAR_API_BASE: 'http://127.0.0.1:4010/v1' })).toEqual(
      [],
    );
    expect(
      parseEnv({ NODE_ENV: 'test', MOYASAR_API_BASE: 'http://127.0.0.1:4010/v1/' })
        .MOYASAR_API_BASE,
    ).toBe('http://127.0.0.1:4010/v1');
  });

  it('wants a long webhook secret and a sane VAT rate', () => {
    expect(problemsOf({ MOYASAR_WEBHOOK_SECRET: 'short' }).join('\n')).toMatch(
      /at least 16 characters/,
    );
    expect(problemsOf({ MOYASAR_WEBHOOK_SECRET: 'a-long-enough-secret-value' })).toEqual([]);
    expect(parseEnv({ VAT_RATE_PERCENT: '5' }).VAT_RATE_PERCENT).toBe(5);
    expect(problemsOf({ VAT_RATE_PERCENT: '-1' })).not.toEqual([]);
    expect(problemsOf({ VAT_RATE_PERCENT: '99' })).not.toEqual([]);
    expect(problemsOf({ BILLING_GATEWAY: 'sometimes' })).not.toEqual([]);
  });
});
