import { requestEmailVerification } from '@/server/auth/verification';
import { accepted, ok } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { VERIFY_REQUEST_RATE_LIMIT } from '../../email-rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/auth/verify-email/request` -> 202 `{ data: { sent: true, verified: false,
 * resendAfterSec } }` once a fresh confirmation link is on its way, or 200 with `sent: false,
 * verified: true` when the address is already confirmed. A second request within 60 seconds is a
 * 429 `rate_limited` whose `details.retryAfterSec` (and `Retry-After`) says how long to wait.
 */
export const POST = route(
  { auth: 'required', rateLimit: VERIFY_REQUEST_RATE_LIMIT },
  async (ctx) => {
    const result = await requestEmailVerification(ctx.auth.user.id);
    return result.sent ? accepted(result) : ok(result);
  },
);
