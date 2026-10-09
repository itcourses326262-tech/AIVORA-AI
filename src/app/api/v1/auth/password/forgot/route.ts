import { addressRoute } from '@/server/auth/address-route';
import { runInBackground } from '@/server/auth/background';
import { requestPasswordReset } from '@/server/auth/password-reset';
import { AUTH_BODY_LIMIT, forgotPasswordSchema } from '@/server/auth/schemas';
import { parseEmail } from '@/server/auth/validation';
import { accepted } from '@/server/http/respond';
import { FORGOT_RATE_LIMIT, FORGOT_SHARED_RATE_LIMIT } from '../../email-rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/password/forgot` `{ email }` -> 202 `{ data: { accepted: true } }`, always.
 *
 * Whether the address belongs to an account must not show, so the answer cannot depend on it:
 * the lookup, the token and the email all happen AFTER the response, on a later turn of the event
 * loop, which also makes the response time independent of the account. The per-address limit
 * (429) and the syntax check (422) say nothing about accounts either. The per-account budget that
 * keeps one inbox from being flooded lives in `requestPasswordReset`, where it is spent only when
 * a mail really goes out: it must not be something a request for a made-up address can use up.
 */
export const POST = addressRoute(
  { auth: 'none', csrf: true, maxBodyBytes: AUTH_BODY_LIMIT },
  { perAddress: FORGOT_RATE_LIMIT, sharedAddress: FORGOT_SHARED_RATE_LIMIT },
  async (ctx) => {
    const body = await ctx.body(forgotPasswordSchema);
    const email = parseEmail(body.email);
    runInBackground('password-reset-request', () => {
      requestPasswordReset(email);
    });
    return accepted({ accepted: true });
  },
);
