import { toUserDTO } from '@/server/auth/dto';
import { retireRequestSession, sessionHeaders } from '@/server/auth/http';
import { AUTH_BODY_LIMIT, loginSchema } from '@/server/auth/schemas';
import { getUserById, loginUser } from '@/server/auth/users';
import { AppError } from '@/lib/errors';
import { ok } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { LOGIN_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/login` `{ email, password }` -> `{ data: UserDTO }` plus the session and
 * locale cookies. Every failure is the same 401, whatever was wrong. A new session token is
 * always issued and the one the request came with is revoked, so a token planted before login
 * (session fixation) never becomes an authenticated one.
 */
export const POST = route(
  { auth: 'none', csrf: true, rateLimit: LOGIN_RATE_LIMIT, maxBodyBytes: AUTH_BODY_LIMIT },
  async (ctx) => {
    const body = await ctx.body(loginSchema);
    const result = await loginUser(body, {
      ip: ctx.ip,
      userAgent: ctx.req.headers.get('user-agent') ?? undefined,
    });
    await retireRequestSession(ctx.req);

    const row = getUserById(result.user.id);
    if (!row) throw AppError.of('internal', 'Account missing right after login');
    return ok(toUserDTO(row), {
      headers: sessionHeaders(result.token, result.expiresAt, row.locale),
    });
  },
);
