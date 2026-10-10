import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  getOptionalUser: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ getOptionalUser: mocks.getOptionalUser }));

import LoginPage from '@/app/(auth)/login/page';
import RegisterPage from '@/app/(auth)/register/page';
import HomePage from '@/app/(marketing)/page';
import PricingPage from '@/app/(marketing)/pricing/page';
import { I18nProvider } from '@/lib/i18n/client';
import { UserProvider } from '@/lib/user-context';
import { resetEnvForTests } from '@/server/env';
import type { ReactElement } from 'react';

// The free credits are for Google sign-up only (SIGNUP_BONUS_PROVIDER=google, the product default),
// so a page may promise them only where Google sign-in can be used. The test setup pins the
// provider to `any` for the other suites; here the real default is back.
const FAKE_KEY = 'k'.repeat(30);
const GOOGLE = {
  FIREBASE_API_KEY: FAKE_KEY,
  FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
};
const FIREBASE_KEYS = [...Object.keys(GOOGLE), 'FIREBASE_APP_ID', 'FIREBASE_AUTH'];

function setEnv(values: Record<string, string> = {}) {
  for (const key of FIREBASE_KEYS) vi.stubEnv(key, values[key] ?? '');
  vi.stubEnv('SIGNUP_BONUS_PROVIDER', values.SIGNUP_BONUS_PROVIDER ?? 'google');
  vi.stubEnv('SIGNUP_BONUS_CREDITS', values.SIGNUP_BONUS_CREDITS ?? '50');
  vi.stubEnv('SIGNUP_ENABLED', values.SIGNUP_ENABLED ?? 'true');
  resetEnvForTests();
}

beforeEach(() => {
  mocks.cookies.clear();
  mocks.getOptionalUser.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

const search = () => ({ searchParams: Promise.resolve({}) });
type LoginProps = ReactElement<{ aside: ReactElement<{ bonus: number }> }>;
type RegisterProps = ReactElement<{ bonus: number; aside: ReactElement<{ bonus: number }> }>;

const offers = async () => {
  const login = (await LoginPage(search())) as LoginProps;
  const register = (await RegisterPage(search())) as RegisterProps;
  return {
    login: login.props.aside.props.bonus,
    registerForm: register.props.bonus,
    registerAside: register.props.aside.props.bonus,
  };
};

const SCENARIOS: Array<[string, Record<string, string>, number]> = [
  ['promises nothing while Google sign-in is not set up and password accounts get none', {}, 0],
  ['promises nothing with Google sign-in switched off', { ...GOOGLE, FIREBASE_AUTH: 'off' }, 0],
  ['promises the amount where Google sign-in is available', GOOGLE, 50],
  ['promises the configured amount', { ...GOOGLE, SIGNUP_BONUS_CREDITS: '120' }, 120],
  ['promises nothing when the amount is zero', { ...GOOGLE, SIGNUP_BONUS_CREDITS: '0' }, 0],
  // Password accounts that earn the credits (development, tests) are never advertised: the copy says
  // "with Google", and there is no Google button to press.
  [
    'does not advertise credits that only password accounts earn (development)',
    { SIGNUP_BONUS_PROVIDER: 'any' },
    0,
  ],
  [
    'promises the amount with Google on, whatever password accounts earn',
    { ...GOOGLE, SIGNUP_BONUS_PROVIDER: 'any' },
    50,
  ],
  [
    'promises nothing when sign-up is closed, even with Google on',
    { ...GOOGLE, SIGNUP_ENABLED: 'false' },
    0,
  ],
];

describe('the log in and register pages', () => {
  it.each(SCENARIOS)('%s', async (_name, env, amount) => {
    setEnv(env);
    expect(await offers()).toEqual({ login: amount, registerForm: amount, registerAside: amount });
  });
});

async function landing() {
  mocks.cookies.set('aivore_locale', 'en');
  return renderToStaticMarkup(await HomePage());
}

async function pricing() {
  mocks.cookies.set('aivore_locale', 'en');
  return renderToStaticMarkup(
    <I18nProvider locale="en">
      <UserProvider initialUser={null}>{await PricingPage()}</UserProvider>
    </I18nProvider>,
  );
}

// An amount nothing else on these pages can be: model prices and pack sizes never collide with it.
const AMOUNT = '77';

describe('the landing and pricing pages', () => {
  it('leave the free credits out where nobody can earn them', async () => {
    setEnv({ SIGNUP_BONUS_CREDITS: AMOUNT });
    expect(await landing()).not.toContain(`${AMOUNT} credits`);
    expect(await pricing()).not.toContain(`${AMOUNT} credits`);
  });

  it('leave them out with Google sign-in switched off', async () => {
    setEnv({ ...GOOGLE, FIREBASE_AUTH: 'off', SIGNUP_BONUS_CREDITS: AMOUNT });
    expect(await landing()).not.toContain(`${AMOUNT} credits`);
    expect(await pricing()).not.toContain(`${AMOUNT} credits`);
  });

  it('promise them where Google sign-in is available', async () => {
    setEnv({ ...GOOGLE, SIGNUP_BONUS_CREDITS: AMOUNT });
    expect(await landing()).toContain(`${AMOUNT} credits`);
    expect(await pricing()).toContain(`${AMOUNT} credits`);
  });

  it('promise them with Google on, and say nothing for password-only credits', async () => {
    setEnv({ ...GOOGLE, SIGNUP_BONUS_PROVIDER: 'any', SIGNUP_BONUS_CREDITS: AMOUNT });
    expect(await landing()).toContain(`${AMOUNT} credits`);
    expect(await pricing()).toContain(`${AMOUNT} credits`);
    setEnv({ SIGNUP_BONUS_PROVIDER: 'any', SIGNUP_BONUS_CREDITS: AMOUNT });
    expect(await landing()).not.toContain(`${AMOUNT} credits`);
    expect(await pricing()).not.toContain(`${AMOUNT} credits`);
  });
});
