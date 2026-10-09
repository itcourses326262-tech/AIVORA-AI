import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  requireUser: vi.fn(),
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
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.requireUser }));

import AccountBillingPage, {
  generateMetadata as billingMetadata,
} from '@/app/(app)/account/billing/page';
import BillingReturnPage, {
  generateMetadata as returnMetadata,
} from '@/app/(app)/billing/return/page';
import { BillingView } from '@/components/billing/billing-view';
import { ReturnView } from '@/components/billing/return-view';
import { resetEnvForTests } from '@/server/env';

beforeEach(() => {
  mocks.cookies.clear();
  mocks.requireUser.mockReset();
  mocks.requireUser.mockResolvedValue({ id: 'usr_1' });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe('/billing/return', () => {
  it('requires a user and brings them back to the very order after logging in', async () => {
    const element = await BillingReturnPage({
      searchParams: Promise.resolve({ order: 'ord_abc' }),
    });
    expect(mocks.requireUser).toHaveBeenCalledWith('/billing/return?order=ord_abc');
    expect(isValidElement(element) && element.type).toBe(ReturnView);
    expect((element as { props: { orderId: string | null } }).props.orderId).toBe('ord_abc');
  });

  it('encodes the order in the path to come back to, so nothing can be smuggled into it', async () => {
    await BillingReturnPage({ searchParams: Promise.resolve({ order: 'x&next=//evil.example' }) });
    expect(mocks.requireUser).toHaveBeenCalledWith(
      '/billing/return?order=x%26next%3D%2F%2Fevil.example',
    );
  });

  it('takes the first value of a repeated parameter', async () => {
    const element = await BillingReturnPage({
      searchParams: Promise.resolve({ order: ['ord_a', 'ord_b'] }),
    });
    expect((element as { props: { orderId: string | null } }).props.orderId).toBe('ord_a');
  });

  it('shows "no order" for a missing parameter, and still requires a user', async () => {
    const element = await BillingReturnPage({ searchParams: Promise.resolve({}) });
    expect(mocks.requireUser).toHaveBeenCalledWith('/billing/return');
    expect((element as { props: { orderId: string | null } }).props.orderId).toBeNull();
  });

  it('renders nothing for a visitor: the guard redirects before any content is built', async () => {
    mocks.requireUser.mockRejectedValue(new Error('NEXT_REDIRECT /login'));
    await expect(
      BillingReturnPage({ searchParams: Promise.resolve({ order: 'ord_abc' }) }),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('is kept out of search engines and has a localized title', async () => {
    mocks.cookies.set('aivore_locale', 'ar');
    const metadata = await returnMetadata();
    expect(metadata.title).toBe('حالة الدفع');
    expect(metadata.robots).toEqual({ index: false });
  });
});

describe('/account/billing', () => {
  it('requires a user, naming its own path', async () => {
    await AccountBillingPage();
    expect(mocks.requireUser).toHaveBeenCalledWith('/account/billing');
  });

  it('tells the view which gateway runs, so only the fake one is announced as a test', async () => {
    vi.stubEnv('BILLING_GATEWAY', 'mock');
    resetEnvForTests();
    const mock = await AccountBillingPage();
    expect(isValidElement(mock) && mock.type).toBe(BillingView);
    expect((mock as { props: { gateway: string } }).props.gateway).toBe('mock');
    vi.stubEnv('BILLING_GATEWAY', 'off');
    resetEnvForTests();
    expect(((await AccountBillingPage()) as { props: { gateway: string } }).props.gateway).toBe(
      'off',
    );
  });

  it('renders no <main> of its own anywhere under (app): the shell has the landmark', () => {
    for (const file of [
      'src/app/(app)/account/billing/page.tsx',
      'src/app/(app)/billing/return/page.tsx',
      'src/components/billing/billing-view.tsx',
      'src/components/billing/return-view.tsx',
      'src/components/billing/orders-card.tsx',
      'src/components/billing/subscription-card.tsx',
    ]) {
      expect(readFileSync(join(process.cwd(), file), 'utf8'), file).not.toMatch(/<main[\s>]/);
    }
  });

  it('has a localized title', async () => {
    mocks.cookies.set('aivore_locale', 'ar');
    expect((await billingMetadata()).title).toBe('الفوترة والباقات');
  });

  it('never calls the billing API itself: money is only ever read by the signed-in browser', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await AccountBillingPage();
    vi.unstubAllGlobals();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
