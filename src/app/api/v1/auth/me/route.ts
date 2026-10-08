import { toUserDTO } from '@/server/auth/dto';
import { refreshedSessionCookie } from '@/server/auth/http';
import { getUserById } from '@/server/auth/users';
import { ok } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { ME_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/auth/me` -> `{ data: UserDTO }`, or `{ data: null }` for visitors (never a 401, so
 * the UI can ask on every page). When this request extended the session it also re-sends the
 * cookie with the new expiry; this is where the browser's cookie slides forward.
 */
export const GET = route({ auth: 'optional', rateLimit: ME_RATE_LIMIT }, async (ctx) => {
  const row = ctx.auth ? getUserById(ctx.auth.user.id) : undefined;
  if (!ctx.auth || !row) return ok(null);

  const response = ok(toUserDTO(row));
  const cookie = refreshedSessionCookie(ctx.req, ctx.auth);
  if (cookie) response.headers.append('Set-Cookie', cookie);
  return response;
});
