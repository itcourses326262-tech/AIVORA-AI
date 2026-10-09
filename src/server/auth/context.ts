import 'server-only';
import { cookies } from 'next/headers';
import type { Locale } from '@/lib/i18n/locales';
import type { UserRow } from '@/server/db/schema';
import { SESSION_COOKIE_NAME, sessionTokenFromCookieHeader } from './cookies';
import { isApiKeyShape, resolveApiKey } from './api-keys';
import { toSessionUser } from './dto';
import { isEmailVerificationRequired } from './email-policy';
import { resolveSession } from './sessions';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  locale: Locale;
  creditBalance: number;
  /**
   * Where the account stands with email confirmation (set by `toSessionUser`; optional so a hand
   * built user, a preview or a test double stays valid). See `UserDTO` for what they mean.
   */
  emailVerified?: boolean;
  emailVerificationRequired?: boolean;
  pendingBonusCredits?: number;
}

export interface AuthContext {
  user: SessionUser;
  via: 'session' | 'api_key';
  sessionId?: string;
  apiKeyId?: string;
  /** Session only: epoch ms at which the session now ends (slides forward while it is used). */
  sessionExpiresAt?: number;
  /** Session only: true when this request extended the session, so the cookie should be re-sent. */
  sessionRefreshed?: boolean;
  /**
   * True when the account must confirm its email address (EMAIL_VERIFICATION policy) and has not.
   * Such an account may sign in and browse but not create generations: the create-generation route
   * answers `email_not_verified` (403). Absent or false otherwise.
   */
  mustVerifyEmail?: boolean;
}

/** An unconfirmed address matters only while the policy requires confirmation. */
function mustConfirm(user: Pick<UserRow, 'emailVerifiedAt'>): boolean {
  return user.emailVerifiedAt === null && isEmailVerificationRequired();
}

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/** The key in an `Authorization: Bearer avk_…` header, or null for any other credentials. */
function apiKeyFromHeader(req: Request): string | null {
  const match = BEARER.exec(req.headers.get('authorization') ?? '');
  const value = match?.[1];
  return value?.startsWith('avk_') ? value : null;
}

/**
 * Bearer `avk_…` -> API key; otherwise the `aivore_session` cookie. Null when unauthenticated.
 * A presented API key is authoritative: if it is wrong, revoked or its owner is disabled the
 * request is anonymous, and a cookie sent alongside is not consulted.
 */
export async function authenticate(req: Request): Promise<AuthContext | null> {
  const key = apiKeyFromHeader(req);
  if (key !== null) {
    if (!isApiKeyShape(key)) return null;
    const resolved = resolveApiKey(key);
    if (!resolved) return null;
    return {
      user: toSessionUser(resolved.user),
      via: 'api_key',
      apiKeyId: resolved.keyId,
      mustVerifyEmail: mustConfirm(resolved.user),
    };
  }

  const token = sessionTokenFromCookieHeader(req.headers.get('cookie'));
  if (token === null) return null;
  const session = resolveSession(token);
  if (!session) return null;
  return {
    user: toSessionUser(session.user),
    via: 'session',
    sessionId: session.sessionId,
    sessionExpiresAt: session.expiresAt,
    sessionRefreshed: session.refreshed,
    mustVerifyEmail: mustConfirm(session.user),
  };
}

/**
 * The signed-in user of the current request, for server components (reads `cookies()`). Null for
 * visitors, expired sessions and disabled accounts. It extends the session in the database like
 * `authenticate` does, but a server component cannot set cookies: the browser's cookie is
 * refreshed by the next `GET /api/v1/auth/me`.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = resolveSession(token);
  return session ? toSessionUser(session.user) : null;
}
