import { expect, type BrowserContext, type Cookie } from '@playwright/test';
import { ApiClient } from './api';

/** The name of the session cookie (see `server/auth/cookies.ts`). */
export const SESSION_COOKIE = 'aivore_session';

/**
 * A session copied out of a browser, as somebody who stole the cookie (or kept an old tab on a
 * shared computer) would hold it. Logging out or resetting a password clears the cookie in the
 * browser that does it, so "the browser is signed out" proves nothing about the SERVER: the copy is
 * what proves that the session row itself is dead.
 */
export interface StolenSession {
  /** The cookies as they were when the copy was made. */
  cookies: Cookie[];
  /** Acts as the thief: a context of its own that holds only the copy. */
  asThief(thief: BrowserContext, baseURL: string): Promise<ApiClient>;
}

export async function stealSession(source: BrowserContext): Promise<StolenSession> {
  const cookies = await source.cookies();
  expect(
    cookies.some((cookie) => cookie.name === SESSION_COOKIE && cookie.value !== ''),
    'the browser should hold a session cookie to copy',
  ).toBe(true);
  return {
    cookies,
    async asThief(thief, baseURL) {
      await thief.addCookies(cookies);
      return new ApiClient(thief.request, baseURL);
    },
  };
}

/**
 * The copy works now (so a later refusal is the server's doing, not a copy that never worked) and
 * returns the thief's client.
 */
export async function expectSessionWorks(
  session: StolenSession,
  thief: BrowserContext,
  baseURL: string,
  accountId: string,
): Promise<ApiClient> {
  const client = await session.asThief(thief, baseURL);
  expect((await client.me())?.id, 'a copy of a live session works').toBe(accountId);
  return client;
}
