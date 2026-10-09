import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  getOptionalUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
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
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth-guard', () => ({ getOptionalUser: mocks.getOptionalUser }));

import LoginPage from '@/app/(auth)/login/page';
import RegisterPage from '@/app/(auth)/register/page';
import { resetEnvForTests } from '@/server/env';
import type { ReactElement } from 'react';

const search = () => ({ searchParams: Promise.resolve({}) });

const PUBLIC_CONFIG = {
  FIREBASE_API_KEY: 'k'.repeat(30),
  FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
};
const FIREBASE_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_AUTH',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'FIREBASE_SERVICE_ACCOUNT_FILE',
];

function setEnv(values: Record<string, string>) {
  for (const key of FIREBASE_KEYS) vi.stubEnv(key, values[key] ?? '');
  resetEnvForTests();
}

beforeEach(() => {
  mocks.cookies.clear();
  mocks.getOptionalUser.mockReset().mockResolvedValue(null);
  setEnv({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

type WithFirebase = ReactElement<{ firebase: unknown }>;

describe.each([
  ['log in', LoginPage],
  ['register', RegisterPage],
])('the %s page', (_name, Page) => {
  it('passes no configuration while Google sign-in is not set up', async () => {
    const element = (await Page(search())) as WithFirebase;
    expect(element.props.firebase).toBeNull();
  });

  it('passes the public identifiers once they are set', async () => {
    setEnv(PUBLIC_CONFIG);
    const element = (await Page(search())) as WithFirebase;
    expect(element.props.firebase).toEqual({
      apiKey: PUBLIC_CONFIG.FIREBASE_API_KEY,
      authDomain: PUBLIC_CONFIG.FIREBASE_AUTH_DOMAIN,
      projectId: PUBLIC_CONFIG.FIREBASE_PROJECT_ID,
    });
  });

  it('adds the app id when there is one', async () => {
    setEnv({ ...PUBLIC_CONFIG, FIREBASE_APP_ID: '1:123:web:abc' });
    const element = (await Page(search())) as WithFirebase;
    expect(element.props.firebase).toMatchObject({ appId: '1:123:web:abc' });
  });

  it('never hands the browser anything but the public identifiers (the service account stays on the server)', async () => {
    setEnv({
      ...PUBLIC_CONFIG,
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"client_email":"sa@test-project.iam.example"}',
      FIREBASE_SERVICE_ACCOUNT_FILE: '/run/secrets/sa.json',
    });
    const element = (await Page(search())) as WithFirebase;
    expect(Object.keys(element.props.firebase as object).toSorted()).toEqual([
      'apiKey',
      'authDomain',
      'projectId',
    ]);
    expect(JSON.stringify(element.props)).not.toMatch(/client_email|sa\.json|SERVICE_ACCOUNT/);
  });

  it('passes none when FIREBASE_AUTH=off', async () => {
    setEnv({ ...PUBLIC_CONFIG, FIREBASE_AUTH: 'off' });
    const element = (await Page(search())) as WithFirebase;
    expect(element.props.firebase).toBeNull();
  });
});
