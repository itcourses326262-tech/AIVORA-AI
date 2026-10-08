import { toUserDTO } from '@/server/auth/dto';
import { sessionHeaders, retireRequestSession } from '@/server/auth/http';
import { registerSchema, AUTH_BODY_LIMIT } from '@/server/auth/schemas';
import { getUserById, registerUser } from '@/server/auth/users';
import { localeFromHeaders } from '@/lib/i18n';
import { AppError } from '@/lib/errors';
import { created } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { REGISTER_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/register` `{ email, password, name, locale? }` -> 201 `{ data: UserDTO }`
 * plus the `aivore_session` and `aivore_locale` cookies. The signup bonus is granted in the same
 * transaction as the account. `csrf: true` because there is no session yet to trigger the
 * same-origin check: browsers must send a matching `Origin`.
 */
export const POST = route(
  { auth: 'none', csrf: true, rateLimit: REGISTER_RATE_LIMIT, maxBodyBytes: AUTH_BODY_LIMIT },
  async (ctx) => {
    const body = await ctx.body(registerSchema);
    const locale = body.locale ?? localeFromHeaders(ctx.req.headers);
    const result = await registerUser(
      { email: body.email, password: body.password, name: body.name, locale },
      { ip: ctx.ip, userAgent: ctx.req.headers.get('user-agent') ?? undefined },
    );
    await retireRequestSession(ctx.req);

    const row = getUserById(result.user.id);
    if (!row) throw AppError.of('internal', 'Account missing right after registration');
    return created(toUserDTO(row), {
      headers: sessionHeaders(result.token, result.expiresAt, row.locale),
    });
  },
);
