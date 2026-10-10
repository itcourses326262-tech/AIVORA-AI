import { addressRoute } from '@/server/auth/address-route';
import { toUserDTO } from '@/server/auth/dto';
import { sessionHeaders, retireRequestSession } from '@/server/auth/http';
import { registerSchema, AUTH_BODY_LIMIT } from '@/server/auth/schemas';
import { getUserById, registerUser } from '@/server/auth/users';
import { localeFromHeaders } from '@/lib/i18n';
import { AppError } from '@/lib/errors';
import { created } from '@/server/http/respond';
import { REGISTER_RATE_LIMIT, REGISTER_SHARED_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/register` `{ email, password, name, locale? }` -> 201 `{ data: UserDTO }`
 * plus the `aivore_session` and `aivore_locale` cookies. The account starts with no credits: the
 * free signup credits go to Google sign-in (SIGNUP_BONUS_PROVIDER; `any` pays them here too, for
 * development). Where emails must be confirmed (EMAIL_VERIFICATION) a confirmation link is mailed
 * and generating waits for it. Also refused here:
 * throwaway-mail domains (`email_not_allowed`) and a client address past its daily cap
 * (`signup_limit`). `csrf: true` because there is no session yet to trigger the same-origin
 * check: browsers must send a matching `Origin`.
 */
export const POST = addressRoute(
  { auth: 'none', csrf: true, maxBodyBytes: AUTH_BODY_LIMIT },
  { perAddress: REGISTER_RATE_LIMIT, sharedAddress: REGISTER_SHARED_RATE_LIMIT },
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
      headers: sessionHeaders(result.token, row.locale),
    });
  },
);
