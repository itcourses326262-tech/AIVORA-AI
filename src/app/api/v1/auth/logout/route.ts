import { clearSessionCookie, sessionTokenFromCookieHeader } from '@/server/auth/cookies';
import { logout } from '@/server/auth/sessions';
import { noContent } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { LOGOUT_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/logout` -> 204 and an expired `aivore_session`. Idempotent: with no or an
 * unknown session it still clears the cookie. It reads the cookie itself instead of requiring
 * authentication so an expired session can always be cleaned up.
 */
export const POST = route(
  { auth: 'none', csrf: true, rateLimit: LOGOUT_RATE_LIMIT },
  async (ctx) => {
    const token = sessionTokenFromCookieHeader(ctx.req.headers.get('cookie'));
    if (token) await logout(token);
    return noContent({ headers: { 'Set-Cookie': clearSessionCookie() } });
  },
);
