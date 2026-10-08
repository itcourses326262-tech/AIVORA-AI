import { act } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { Toaster, toast } from '@/components/ui/toast';
import type { Locale } from '@/lib/i18n/locales';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { json } from '../auth/support';
import { renderUi } from '../render';

export { apiError, json, router } from '../auth/support';

export const LAYLA: CurrentUser = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla',
  role: 'user',
  locale: 'en',
  creditBalance: 120,
};

export function mountAccount(
  ui: ReactElement,
  { locale = 'en', user = LAYLA }: { locale?: Locale; user?: CurrentUser } = {},
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
 * signed-in user unless a test says otherwise, because the balance card reads it.
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

/** Clears the toasts left on screen and restores `fetch`, between tests. */
export function resetAccountTest() {
  vi.useFakeTimers();
  act(() => {
    toast.dismissAll();
    vi.advanceTimersByTime(1000);
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.cookie = 'aivore_locale=; Max-Age=0; Path=/';
  window.history.replaceState(null, '', '/account');
}
