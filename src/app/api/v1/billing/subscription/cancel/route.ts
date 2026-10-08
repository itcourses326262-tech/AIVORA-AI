import { requireBrowserSession } from '@/server/billing/guards';
import { cancelSubscription } from '@/server/billing/subscriptions';
import { route } from '@/server/http/route';
import { SUBSCRIPTION_WRITE_LIMIT } from '../../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ends the subscription when the paid month does. Idempotent. Credits never expire. */
export const POST = route(
  { auth: 'required', rateLimit: SUBSCRIPTION_WRITE_LIMIT },
  async (ctx) => {
    requireBrowserSession(ctx.auth);
    return cancelSubscription(ctx.auth.user.id);
  },
);
