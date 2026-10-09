import { act, screen } from '@testing-library/react';
import { vi } from 'vitest';

/** The App Router hooks the forms use, shared by the form tests. */
export const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const apiError = (status: number, code: string, details?: unknown): Response =>
  json({ error: { code, message: 'English message for developers', details } }, status);

export function stubFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The parsed JSON body of the n-th request. */
export function bodyOf(fetchMock: ReturnType<typeof stubFetch>, call = 0): unknown {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body));
}

/** Pretends the device has a keyboard and mouse (a desktop), so the first field takes focus. */
export function stubDesktopPointer() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: query.includes('pointer: fine'), media: query })),
  );
}

/**
 * Moves focus to a link the way a press on it does (the field being left gets a blur whose
 * `relatedTarget` is the link), without clicking: jsdom cannot navigate and would print a warning.
 */
export async function focusLink(name: string) {
  const link = screen.getByRole('link', { name });
  await act(async () => link.focus());
}
