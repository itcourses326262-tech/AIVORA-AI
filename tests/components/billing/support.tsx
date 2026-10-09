import { act } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { resetResendCooldownForTests } from '@/components/layout/verify-email-banner';
import { Toaster, toast } from '@/components/ui/toast';
import type { BillingCatalogDTO, OrderDTO, Page, SubscriptionDTO } from '@/lib/api-types';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS, splitVat } from '@/lib/billing/plans';
import { DAY_MS } from '@/lib/billing/period';
import { newId } from '@/lib/id';
import type { Locale } from '@/lib/i18n/locales';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { renderUi } from '../render';

export const LAYLA: CurrentUser = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla',
  role: 'user',
  locale: 'en',
  creditBalance: 120,
};

/** A fixed "now" so dates in the fixtures and in the assertions agree. */
export const NOW = Date.UTC(2026, 9, 8, 12, 0);

/** Text as a reader sees it: no bidi marks, one kind of space. `Intl` puts both into money. */
export const plain = (text: string) =>
  text
    .replace(/[\u200e\u200f\u061c\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A `getByText` matcher that ignores the bidi marks and no-break spaces of `Intl` output. */
export const text = (expected: string) => (content: string) => plain(content) === plain(expected);

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export const apiError = (status: number, code: string, details?: unknown): Response =>
  json({ error: { code, message: 'English message for developers', details } }, status);

/** The price list the server sends, built from the shared plans so prices stay the real ones. */
export function catalog(overrides: Partial<BillingCatalogDTO> = {}): BillingCatalogDTO {
  const vatPercent = 15;
  const vatOf = (priceHalalas: number) => splitVat(priceHalalas, vatPercent).vatHalalas;
  return {
    currency: 'SAR',
    vatPercent,
    gateway: 'moyasar',
    canPurchase: true,
    packs: CREDIT_PACKS.map((pack) => ({
      id: pack.id,
      credits: pack.credits,
      priceHalalas: pack.priceHalalas,
      vatHalalas: vatOf(pack.priceHalalas),
      name: pack.name,
      description: pack.description,
      popular: 'popular' in pack && pack.popular === true,
    })),
    plans: SUBSCRIPTION_PLANS.map((plan) => ({
      id: plan.id,
      monthlyCredits: plan.monthlyCredits,
      priceHalalas: plan.priceHalalas,
      vatHalalas: vatOf(plan.priceHalalas),
      name: plan.name,
      description: plan.description,
      popular: 'popular' in plan && plan.popular === true,
    })),
    renewal: { leadDays: 3, graceDays: 7 },
    ...overrides,
  };
}

export function order(overrides: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id: newId('ord'),
    kind: 'pack',
    itemId: 'pack-1500',
    amountHalalas: 7_900,
    vatHalalas: 1_030,
    currency: 'SAR',
    credits: 1_500,
    status: 'paid',
    createdAt: NOW - DAY_MS,
    paidAt: NOW - DAY_MS + 60_000,
    refundedHalalas: 0,
    clawedBackCredits: 0,
    ...overrides,
  };
}

export function pendingOrder(overrides: Partial<OrderDTO> = {}): OrderDTO {
  const { paidAt: _paidAt, ...base } = order();
  return {
    ...base,
    status: 'pending',
    expiresAt: NOW + DAY_MS,
    checkoutUrl: 'https://pay.example.com/invoices/inv_1',
    ...overrides,
  };
}

export function subscription(overrides: Partial<SubscriptionDTO> = {}): SubscriptionDTO {
  return {
    id: newId('sub'),
    planId: 'pro',
    status: 'active',
    currentPeriodStart: NOW - 10 * DAY_MS,
    currentPeriodEnd: NOW + 20 * DAY_MS,
    cancelAtPeriodEnd: false,
    createdAt: NOW - 10 * DAY_MS,
    ...overrides,
  };
}

export function pageOf<T>(data: T[], nextCursor: string | null = null): Page<T> {
  return { data, nextCursor };
}

export function mountBilling(
  ui: ReactElement,
  { locale = 'en', user = LAYLA }: { locale?: Locale; user?: CurrentUser | null } = {},
) {
  return renderUi(
    <UserProvider initialUser={user}>
      {ui}
      <Toaster />
    </UserProvider>,
    { locale },
  );
}

export interface Call {
  method: string;
  /** The path below `/api/v1`, without the query. */
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
  signal: AbortSignal | null | undefined;
}

export type Handler = (call: Call) => Response | Promise<Response>;

export interface FakeApi {
  calls: Call[];
  /** Requests nobody planned for: a test fails when this is not empty. */
  unplanned: string[];
  /** The calls made to `METHOD /path`, oldest first. */
  to: (route: string) => Call[];
  /** Replaces what a route answers from now on. */
  on: (route: string, handler: Handler) => void;
}

/**
 * Stubs `fetch` with answers per `METHOD /path` (below `/api/v1`). `GET /auth/me` answers with the
 * signed-in user unless a test says otherwise, because the pages refresh the balance through it.
 */
export function installFakeApi(routes: Record<string, Handler> = {}): FakeApi {
  const table = new Map<string, Handler>(Object.entries(routes));
  const calls: Call[] = [];
  const unplanned: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost');
      const method = (init.method ?? 'GET').toUpperCase();
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const call: Call = {
        method,
        path,
        query: url.searchParams,
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        headers: new Headers(init.headers),
        signal: init.signal,
      };
      calls.push(call);
      const handler = table.get(`${method} ${path}`);
      if (handler) return handler(call);
      if (method === 'GET' && path === '/auth/me') return json({ data: LAYLA });
      unplanned.push(`${method} ${path}`);
      return json({ error: { code: 'not_found', message: 'No such route in this test' } }, 404);
    }),
  );
  return {
    calls,
    unplanned,
    to: (route) => calls.filter((call) => `${call.method} ${call.path}` === route),
    on: (route, handler) => void table.set(route, handler),
  };
}

/** Clears the toasts left on screen and restores `fetch` and the timers, between tests. */
export function resetBillingTest() {
  resetResendCooldownForTests();
  vi.useFakeTimers();
  act(() => {
    toast.dismissAll();
    vi.advanceTimersByTime(1000);
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.cookie = 'aivore_locale=; Max-Age=0; Path=/';
  window.history.replaceState(null, '', '/');
}
