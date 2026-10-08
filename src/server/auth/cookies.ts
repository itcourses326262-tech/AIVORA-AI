// OWNER: auth-security — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';

/** `Set-Cookie` value: `aivore_session`, HttpOnly, SameSite=Lax, Path=/, Secure in production. */
export function sessionCookie(_token: string, _expiresAt: number): string {
  throw new NotImplementedError('auth.sessionCookie');
}

/** `Set-Cookie` value that removes the session cookie. */
export function clearSessionCookie(): string {
  throw new NotImplementedError('auth.clearSessionCookie');
}
