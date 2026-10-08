import { addressRoute } from '@/server/auth/address-route';
import { AUTH_BODY_LIMIT, confirmEmailSchema } from '@/server/auth/schemas';
import { confirmEmailVerification } from '@/server/auth/verification';
import { ok } from '@/server/http/respond';
import {
  VERIFY_CONFIRM_RATE_LIMIT,
  VERIFY_CONFIRM_SHARED_RATE_LIMIT,
} from '../../email-rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/verify-email/confirm` `{ token }` -> `{ data: { verified: true,
 * alreadyVerified, bonusCredits } }`. The link in the email opens a PAGE that calls this; the page
 * load itself changes nothing, so mail scanners that fetch links cannot burn them. No session is
 * needed (the link may be opened on another device); a link that cannot be used is a 400
 * `bad_request` with `details.reason` of `invalid`, `expired` or `used`.
 */
export const POST = addressRoute(
  { auth: 'none', maxBodyBytes: AUTH_BODY_LIMIT },
  { perAddress: VERIFY_CONFIRM_RATE_LIMIT, sharedAddress: VERIFY_CONFIRM_SHARED_RATE_LIMIT },
  async (ctx) => {
    const body = await ctx.body(confirmEmailSchema);
    return ok(confirmEmailVerification(body.token));
  },
);
