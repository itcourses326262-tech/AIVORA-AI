import 'server-only';
import { AppError } from '@/lib/errors';
import type { Locale } from '@/lib/i18n/locales';
import { serializeLocaleCookie } from '@/lib/i18n';
import type { AuthContext } from './context';
import { logout, sessionCookieExpiry } from './sessions';
import { sessionCookie, sessionTokenFromCookieHeader } from './cookies';

/**
 * The `Set-Cookie` headers of a response that opens a session: the session and the locale. The
 * session cookie lives until the session's absolute cap and is never re-sent afterwards (see
 * `sessionCookieExpiry`); `createdAt` is when the session was opened (now, for a fresh login).
 */
export function sessionHeaders(
  token: string,
  locale: Locale,
  createdAt: number = Date.now(),
): Headers {
  const headers = new Headers();
  headers.append('Set-Cookie', sessionCookie(token, sessionCookieExpiry(createdAt)));
  headers.append('Set-Cookie', serializeLocaleCookie(locale));
  return headers;
}

/** Ends the session the request arrived with, if any (login and register replace it). */
export async function retireRequestSession(req: Request): Promise<void> {
  const token = sessionTokenFromCookieHeader(req.headers.get('cookie'));
  if (token) await logout(token);
}

/**
 * Endpoints for managing credentials (API keys, password, sign-out everywhere) accept a browser
 * session only: a leaked API key must not be able to mint more keys or lock the owner out.
 * Returns the session id.
 */
export function requireSession(auth: AuthContext): string {
  if (auth.via !== 'session' || auth.sessionId === undefined) {
    throw AppError.of('forbidden', 'This endpoint requires a signed-in session, not an API key');
  }
  return auth.sessionId;
}
