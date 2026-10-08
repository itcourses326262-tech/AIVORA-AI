import 'server-only';
import { getEnv } from '@/server/env';
import { SESSION_COOKIE_NAME } from '@/server/http/request';

export { SESSION_COOKIE_NAME };

/** Session tokens are 32 random bytes as base64url (see `generateToken`). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * `Secure` in production, where the app must be served over HTTPS (a browser also accepts it on
 * `http://localhost`, so local production-mode runs keep working).
 */
function attributes(): string[] {
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (getEnv().NODE_ENV === 'production') parts.push('Secure');
  return parts;
}

/** `Set-Cookie` value: `aivore_session`, HttpOnly, SameSite=Lax, Path=/, Secure in production. */
export function sessionCookie(token: string, expiresAt: number): string {
  const maxAgeSec = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
    `Max-Age=${maxAgeSec}`,
    ...attributes(),
  ].join('; ');
}

/** `Set-Cookie` value that removes the session cookie. */
export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    ...attributes(),
  ].join('; ');
}

/**
 * The session token in a `Cookie` header, or null. Only well-formed tokens are returned, so
 * garbage never reaches the hash or the database.
 */
export function sessionTokenFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    let value = pair.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    // The first cookie of that name wins; a later duplicate cannot override it.
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

/** True for tokens that could be a session token. */
export function isSessionTokenShape(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
