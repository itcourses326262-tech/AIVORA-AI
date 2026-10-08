import 'server-only';
import { AppError } from '@/lib/errors';
import type { Locale } from '@/lib/i18n/locales';
import { serializeLocaleCookie } from '@/lib/i18n';
import type { AuthContext } from './context';
import { logout } from './sessions';
import { sessionCookie, sessionTokenFromCookieHeader } from './cookies';

/** The `Set-Cookie` headers of a response that opens a session: the session and the locale. */
export function sessionHeaders(token: string, expiresAt: number, locale: Locale): Headers {
  const headers = new Headers();
  headers.append('Set-Cookie', sessionCookie(token, expiresAt));
  headers.append('Set-Cookie', serializeLocaleCookie(locale));
  return headers;
}

/** Ends the session the request arrived with, if any (login and register replace it). */
export async function retireRequestSession(req: Request): Promise<void> {
  const token = sessionTokenFromCookieHeader(req.headers.get('cookie'));
  if (token) await logout(token);
}

/**
 * The `Set-Cookie` that carries a session's extended expiry, or null when this request did not
 * extend it. Without it the browser would drop the cookie 30 days after login even though the
 * server keeps sliding the session forward.
 */
export function refreshedSessionCookie(req: Request, auth: AuthContext): string | null {
  if (auth.via !== 'session' || !auth.sessionRefreshed || auth.sessionExpiresAt === undefined) {
    return null;
  }
  const token = sessionTokenFromCookieHeader(req.headers.get('cookie'));
  return token ? sessionCookie(token, auth.sessionExpiresAt) : null;
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
