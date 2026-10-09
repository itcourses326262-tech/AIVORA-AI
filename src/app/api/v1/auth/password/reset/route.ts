import { addressRoute } from '@/server/auth/address-route';
import { resetPassword } from '@/server/auth/password-reset';
import { AUTH_BODY_LIMIT, resetPasswordSchema } from '@/server/auth/schemas';
import { noContent } from '@/server/http/respond';
import { RESET_RATE_LIMIT } from '../../email-rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/password/reset` `{ token, password }` -> 204. The link is single use and
 * works for an hour. Every session of the account is revoked (this call opens none: the user logs
 * in with the new password), other reset links die, a "password changed" notice is mailed. A link
 * that cannot be used is a 400 `bad_request` with `details.reason` (`invalid`, `expired`, `used`);
 * a password the policy refuses is a 422 at path `password` and does NOT burn the link.
 * `csrf: true` like login: browsers must send a matching `Origin`.
 */
export const POST = addressRoute(
  { auth: 'none', csrf: true, maxBodyBytes: AUTH_BODY_LIMIT },
  { perAddress: RESET_RATE_LIMIT, sharedAddress: false },
  async (ctx) => {
    const body = await ctx.body(resetPasswordSchema);
    await resetPassword(body.token, body.password);
    return noContent();
  },
);
