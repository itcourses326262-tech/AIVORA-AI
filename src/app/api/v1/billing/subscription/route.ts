import { requireBrowserSession } from '@/server/billing/guards';
import { currentSubscription } from '@/server/billing/subscriptions';
import { route } from '@/server/http/route';
import { BILLING_READ_LIMIT } from '../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The caller's subscription: the running one, otherwise the last one that ended, otherwise
 * `null`. While a first month or a renewal is unpaid it carries `pendingOrder.checkoutUrl`.
 */
export const GET = route({ auth: 'required', rateLimit: BILLING_READ_LIMIT }, async (ctx) => {
  requireBrowserSession(ctx.auth);
  return currentSubscription(ctx.auth.user.id);
});
