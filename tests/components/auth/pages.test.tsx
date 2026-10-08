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

import LoginPage, { generateMetadata as loginMetadata } from '@/app/(auth)/login/page';
import RegisterPage, { generateMetadata as registerMetadata } from '@/app/(auth)/register/page';
import { AuthAside } from '@/components/auth/auth-aside';
import { LoginForm } from '@/components/auth/login-form';
import { RegisterForm } from '@/components/auth/register-form';
import { resetEnvForTests } from '@/server/env';
import type { ReactElement } from 'react';

const search = (value: Record<string, string | string[] | undefined>) => ({
  searchParams: Promise.resolve(value),
});

async function redirectedTo(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const match = /^NEXT_REDIRECT:(.*)$/.exec(
      String(error instanceof Error ? error.message : error),
    );
    if (!match) throw error;
    return match[1] ?? null;
  }
}

beforeEach(() => {
  mocks.cookies.clear();
  mocks.getOptionalUser.mockReset().mockResolvedValue(null);
  mocks.redirect.mockClear();
});

afterEach(() => {
  process.env.SIGNUP_ENABLED = 'true';
  resetEnvForTests();
});

describe('log in page', () => {
  it('shows the form, heading for the safe page the visitor was after', async () => {
    const page = (await LoginPage(search({ next: '/gallery/gen_1' }))) as ReactElement<{
      next: string;
      aside: ReactElement<{ bonus: number }>;
    }>;
    expect(page.type).toBe(LoginForm);
    expect(page.props.next).toBe('/gallery/gen_1');
    // The wide-screen panel comes along, with the bonus the server is configured to give.
    expect(page.props.aside.type).toBe(AuthAside);
    expect(page.props.aside.props.bonus).toBe(50);
  });

  it.each([
    [{}],
    [{ next: '//evil.com' }],
    [{ next: 'https://evil.com' }],
    [{ next: '/\\evil.com' }],
    [{ next: '/login' }],
    [{ next: ['//evil.com', '/gallery'] }],
    [{ next: '' }],
  ])('falls back to the studio for the query %j', async (query) => {
    const page = (await LoginPage(search(query))) as ReactElement<{ next: string }>;
    expect(page.props.next).toBe('/studio');
  });

  it('uses the first of a repeated parameter', async () => {
    const page = (await LoginPage(search({ next: ['/gallery', '/account'] }))) as ReactElement<{
      next: string;
    }>;
    expect(page.props.next).toBe('/gallery');
  });

  it('sends somebody who is already logged in on to the safe page, not to the form', async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: 'usr_1' });
    expect(await redirectedTo(() => LoginPage(search({ next: '/gallery' })))).toBe('/gallery');
    expect(await redirectedTo(() => LoginPage(search({})))).toBe('/studio');
    expect(await redirectedTo(() => LoginPage(search({ next: '//evil.com' })))).toBe('/studio');
    expect(await redirectedTo(() => LoginPage(search({ next: 'https://evil.com/x' })))).toBe(
      '/studio',
    );
  });

  it('lets a failing session lookup through to the caller instead of hiding it', async () => {
    mocks.getOptionalUser.mockRejectedValue(new Error('database is down'));
    await expect(LoginPage(search({}))).rejects.toThrow('database is down');
  });

  it('titles the tab in the active language', async () => {
    expect(await loginMetadata()).toEqual({ title: 'تسجيل الدخول' });
    mocks.cookies.set('aivore_locale', 'en');
    expect(await loginMetadata()).toEqual({ title: 'Log in' });
  });
});

describe('register page', () => {
  it('shows the form with the bonus and an open registration from the environment', async () => {
    const page = (await RegisterPage(search({ next: '/account' }))) as ReactElement<{
      next: string;
      bonus: number;
      signupOpen: boolean;
      aside: ReactElement;
    }>;
    expect(page.type).toBe(RegisterForm);
    expect(page.props).toMatchObject({ next: '/account', bonus: 50, signupOpen: true });
    expect(page.props.aside.type).toBe(AuthAside);
  });

  it('says so when the server has closed registration', async () => {
    process.env.SIGNUP_ENABLED = 'false';
    resetEnvForTests();
    const page = (await RegisterPage(search({}))) as ReactElement<{ signupOpen: boolean }>;
    expect(page.props.signupOpen).toBe(false);
  });

  it('applies the same redirect rules as the log in page', async () => {
    const page = (await RegisterPage(search({ next: '//evil.com' }))) as ReactElement<{
      next: string;
    }>;
    expect(page.props.next).toBe('/studio');
    mocks.getOptionalUser.mockResolvedValue({ id: 'usr_1' });
    expect(await redirectedTo(() => RegisterPage(search({ next: '/gallery' })))).toBe('/gallery');
    expect(await redirectedTo(() => RegisterPage(search({ next: 'https://evil.com' })))).toBe(
      '/studio',
    );
  });

  it('titles the tab in the active language', async () => {
    expect(await registerMetadata()).toEqual({ title: 'إنشاء الحساب' });
    mocks.cookies.set('aivore_locale', 'en');
    expect(await registerMetadata()).toEqual({ title: 'Create account' });
  });
});
