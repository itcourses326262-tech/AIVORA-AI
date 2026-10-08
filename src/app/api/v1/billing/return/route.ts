import { resolveReturn } from '@/server/billing/return';
import { addressRoute } from '@/server/auth/address-route';
import { getEnv } from '@/server/env';
import { RETURN_LIMITS } from '../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where the gateway sends the buyer's browser after the payment page (success and "back"). It
 * re-checks the order with the gateway, then redirects to `/billing/return?order=<id>` on our own
 * origin. Nothing from the query string is trusted or echoed except an id that exists in our database.
 */
export const GET = addressRoute({ auth: 'none' }, RETURN_LIMITS, async (ctx) => {
  const order = new URL(ctx.req.url).searchParams.get('order');
  const target = await resolveReturn(order);
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(target, getEnv().APP_URL).toString() },
  });
});
