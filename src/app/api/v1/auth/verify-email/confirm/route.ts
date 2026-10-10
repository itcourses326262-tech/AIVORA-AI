import { addressRoute } from '@/server/auth/address-route';
import { AUTH_BODY_LIMIT, confirmEmailSchema } from '@/server/auth/schemas';
import { confirmEmailVerification } from '@/server/auth/verification';
import { ok } from '@/server/http/respond';
import { VERIFY_CONFIRM_RATE_LIMIT } from '../../email-rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/verify-email/confirm` `{ token }` -> `{ data: { verified: true,
 * alreadyVerified, bonusCredits } }` (`bonusCredits` is 0 unless SIGNUP_BONUS_PROVIDER=any: the
 * free credits are for Google sign-in). The link in the email opens a PAGE that calls this; the page
 * load itself changes nothing, so mail scanners that fetch links cannot burn them. No session is
 * needed (the link may be opened on another device); a link that cannot be used is a 400
 * `bad_request` with `details.reason` of `invalid`, `expired` or `used`.
 *
 * A browser session is looked at for one thing only: when it belongs to the account the link is
 * for, the person confirming holds both the account and the mailbox, and an `ADMIN_EMAILS`
 * address is promoted. A bare click (no session, another account, an API key) just confirms, so a
 * squatter who registered somebody else's address cannot inherit admin when the owner clicks.
 */
export const POST = addressRoute(
  { auth: 'optional', maxBodyBytes: AUTH_BODY_LIMIT },
  { perAddress: VERIFY_CONFIRM_RATE_LIMIT, sharedAddress: false },
  async (ctx) => {
    const body = await ctx.body(confirmEmailSchema);
    const signedInUserId = ctx.auth?.via === 'session' ? ctx.auth.user.id : undefined;
    return ok(confirmEmailVerification(body.token, Date.now(), { signedInUserId }));
  },
);
