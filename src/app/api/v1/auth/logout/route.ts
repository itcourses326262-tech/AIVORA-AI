import { addressRoute } from '@/server/auth/address-route';
import { clearSessionCookie, sessionTokenFromCookieHeader } from '@/server/auth/cookies';
import { logout } from '@/server/auth/sessions';
import { noContent } from '@/server/http/respond';
import { LOGOUT_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/logout` -> 204 and an expired `aivore_session`. Idempotent: with no or an
 * unknown session it still clears the cookie. It reads the cookie itself instead of requiring
 * authentication so an expired session can always be cleaned up.
 */
export const POST = addressRoute(
  { auth: 'none', csrf: true },
  { perAddress: LOGOUT_RATE_LIMIT, sharedAddress: false },
  async (ctx) => {
    const token = sessionTokenFromCookieHeader(ctx.req.headers.get('cookie'));
    if (token) await logout(token);
    return noContent({ headers: { 'Set-Cookie': clearSessionCookie() } });
  },
);
