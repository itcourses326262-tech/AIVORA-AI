import { requireBrowserSession } from '@/server/billing/guards';
import { resumeSubscription } from '@/server/billing/subscriptions';
import { route } from '@/server/http/route';
import { SUBSCRIPTION_WRITE_LIMIT } from '../../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Takes back a cancellation while the paid month is still running (409 once it has ended). */
export const POST = route(
  { auth: 'required', rateLimit: SUBSCRIPTION_WRITE_LIMIT },
  async (ctx) => {
    requireBrowserSession(ctx.auth);
    return resumeSubscription(ctx.auth.user.id);
  },
);
