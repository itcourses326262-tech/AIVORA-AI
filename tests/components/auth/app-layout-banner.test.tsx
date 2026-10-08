import { Children, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppUser: vi.fn(),
  getVerificationState: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/auth-guard', () => ({ getAppUser: mocks.getAppUser }));
vi.mock('@/server/auth/verification', () => ({
  getVerificationState: mocks.getVerificationState,
}));

import AppLayout from '@/app/(app)/layout';
import { AppShell } from '@/components/layout/app-shell';
import { RedirectToLogin } from '@/components/layout/redirect-to-login';
import { VerifyEmailBanner } from '@/components/layout/verify-email-banner';

const USER = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla',
  role: 'user',
  locale: 'en',
  creditBalance: 0,
};
const PAGE = <p>the page</p>;

/** `Children.toArray` re-keys elements, so compare what the page renders, not the element. */
const pageOf = (child: ReactNode) => (child as ReactElement<{ children: string }>).props.children;

async function shellChildren(): Promise<ReactNode[]> {
  const layout = (await AppLayout({ children: PAGE })) as ReactElement<{ children: ReactNode }>;
  expect(layout.type).toBe(AppShell);
  return Children.toArray(layout.props.children);
}

beforeEach(() => {
  mocks.getAppUser.mockReset().mockResolvedValue(USER);
  mocks.getVerificationState.mockReset().mockReturnValue(null);
});

describe('(app) layout and the email confirmation banner', () => {
  it('shows the banner above the page while the server requires a confirmed address', async () => {
    mocks.getVerificationState.mockReturnValue({
      required: true,
      verified: false,
      email: 'layla@example.com',
      resendAfterSec: 42,
      bonusCredits: 50,
    });
    const children = await shellChildren();
    expect(children).toHaveLength(2);
    const banner = children[0] as ReactElement<Record<string, unknown>>;
    expect(banner.type).toBe(VerifyEmailBanner);
    expect(banner.props).toEqual({
      email: 'layla@example.com',
      bonusCredits: 50,
      resendAfterSec: 42,
    });
    expect(pageOf(children[1])).toBe('the page');
    expect(mocks.getVerificationState).toHaveBeenCalledWith('usr_1');
  });

  it.each([
    ['confirmation is not required', { required: false, verified: false }],
    ['the address is confirmed', { required: true, verified: true }],
    ['the account is unknown to the database (the development preview user)', null],
  ])('shows no banner when %s', async (_label, state) => {
    mocks.getVerificationState.mockReturnValue(
      state && { email: 'layla@example.com', resendAfterSec: 0, bonusCredits: 0, ...state },
    );
    const children = await shellChildren();
    expect(children).toHaveLength(1);
    expect(pageOf(children[0])).toBe('the page');
  });

  it('still sends a visitor to log in, without looking anything up', async () => {
    mocks.getAppUser.mockResolvedValue(null);
    const layout = (await AppLayout({ children: PAGE })) as ReactElement<{
      children: ReactElement;
    }>;
    expect(layout.props.children.type).toBe(RedirectToLogin);
    expect(mocks.getVerificationState).not.toHaveBeenCalled();
  });
});
