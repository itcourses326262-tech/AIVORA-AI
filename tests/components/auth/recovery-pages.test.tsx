import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOptionalUser: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock('@/lib/auth-guard', () => ({ getOptionalUser: mocks.getOptionalUser }));

import ForgotPasswordPage, {
  generateMetadata as forgotMetadata,
} from '@/app/(auth)/forgot-password/page';
import ResetPasswordPage, {
  generateMetadata as resetMetadata,
} from '@/app/(auth)/reset-password/page';
import VerifyEmailPage, {
  generateMetadata as verifyMetadata,
} from '@/app/(auth)/verify-email/page';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';

const search = (value: Record<string, string | string[] | undefined>) => ({
  searchParams: Promise.resolve(value),
});

beforeEach(() => {
  mocks.getOptionalUser.mockReset().mockResolvedValue(null);
});

describe('forgot password page', () => {
  it('shows the form, to a visitor and to somebody who is signed in', async () => {
    expect((ForgotPasswordPage() as ReactElement).type).toBe(ForgotPasswordForm);
    // It never asks who is looking: a signed-in person may have forgotten the password too.
    expect(mocks.getOptionalUser).not.toHaveBeenCalled();
  });

  it('is titled in the active language (Arabic by default)', async () => {
    expect(await forgotMetadata()).toEqual({ title: 'نسيت كلمة المرور؟' });
  });
});

describe('reset password page', () => {
  it('hands the token of the link to the form', async () => {
    const page = (await ResetPasswordPage(search({ token: 'abc' }))) as ReactElement<{
      token: string | null;
    }>;
    expect(page.type).toBe(ResetPasswordForm);
    expect(page.props.token).toBe('abc');
  });

  it.each([
    [{}, null],
    [{ token: '' }, null],
    [{ token: ['first', 'second'] }, 'first'],
  ])('reads the query %j as token %j', async (query, expected) => {
    const page = (await ResetPasswordPage(search(query))) as ReactElement<{ token: string | null }>;
    expect(page.props.token).toBe(expected);
  });

  it('keeps the secret in the address from leaking in a Referer header', async () => {
    expect(await resetMetadata()).toMatchObject({ referrer: 'no-referrer' });
  });
});

describe('verify email page', () => {
  it('hands the token and whether somebody is signed in to the panel, and does not confirm by rendering', async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: 'usr_1' });
    const page = (await VerifyEmailPage(search({ token: 'abc' }))) as ReactElement<{
      token: string | null;
      signedIn: boolean;
    }>;
    expect(page.type).toBe(VerifyEmailPanel);
    expect(page.props).toMatchObject({ token: 'abc', signedIn: true });
  });

  it('knows a visitor, and a link without a token', async () => {
    const page = (await VerifyEmailPage(search({}))) as ReactElement<{
      token: string | null;
      signedIn: boolean;
    }>;
    expect(page.props).toMatchObject({ token: null, signedIn: false });
  });

  it('keeps the secret in the address from leaking in a Referer header', async () => {
    expect(await verifyMetadata()).toMatchObject({ referrer: 'no-referrer' });
  });
});
