import { requireBrowserSession } from '@/server/billing/guards';
import { listOrders } from '@/server/billing/orders';
import { pageQuerySchema } from '@/server/http/request';
import { page } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { BILLING_READ_LIMIT } from '../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `GET /api/v1/billing/orders?limit=&cursor=` -> the caller's orders, newest first. */
export const GET = route({ auth: 'required', rateLimit: BILLING_READ_LIMIT }, async (ctx) => {
  requireBrowserSession(ctx.auth);
  const { limit, cursor } = ctx.query(pageQuerySchema);
  const result = listOrders(ctx.auth.user.id, { limit, cursor });
  return page(result.data, result.nextCursor);
});
