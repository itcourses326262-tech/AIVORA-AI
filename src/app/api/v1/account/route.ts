import { toUserDTO } from '@/server/auth/dto';
import { AUTH_BODY_LIMIT, updateAccountSchema } from '@/server/auth/schemas';
import { getUserById, updateAccount } from '@/server/auth/users';
import { AppError } from '@/lib/errors';
import { serializeLocaleCookie } from '@/lib/i18n';
import { ok } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { ACCOUNT_READ_RATE_LIMIT, ACCOUNT_WRITE_RATE_LIMIT } from './rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `GET /api/v1/account` -> `{ data: UserDTO }` (session or API key). */
export const GET = route({ auth: 'required', rateLimit: ACCOUNT_READ_RATE_LIMIT }, async (ctx) => {
  const row = getUserById(ctx.auth.user.id);
  if (!row) throw AppError.of('not_found', 'User not found');
  return toUserDTO(row);
});

/**
 * `PATCH /api/v1/account` `{ name?, locale? }` -> `{ data: UserDTO }`. A language change also
 * updates the `aivore_locale` cookie, so the next page render is already in that language.
 */
export const PATCH = route(
  { auth: 'required', rateLimit: ACCOUNT_WRITE_RATE_LIMIT, maxBodyBytes: AUTH_BODY_LIMIT },
  async (ctx) => {
    const patch = await ctx.body(updateAccountSchema);
    const row = updateAccount(ctx.auth.user.id, patch);
    const headers = new Headers();
    if (patch.locale !== undefined) {
      headers.append('Set-Cookie', serializeLocaleCookie(patch.locale));
    }
    return ok(toUserDTO(row), { headers });
  },
);
