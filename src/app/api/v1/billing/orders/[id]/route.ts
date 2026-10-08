import { AppError } from '@/lib/errors';
import { isValidId } from '@/lib/id';
import { toOrderDTO } from '@/server/billing/dto';
import { requireBrowserSession } from '@/server/billing/guards';
import { findOwnedOrder } from '@/server/billing/orders';
import { refreshOrder } from '@/server/billing/settle';
import { getDb } from '@/server/db';
import { route } from '@/server/http/route';
import { getLogger } from '@/server/logger';
import { BILLING_READ_LIMIT } from '../../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How often one pending order may cost the gateway a call, however many tabs poll it. */
const POLL_MIN_INTERVAL_MS = 3_000;

/**
 * One of the caller's orders (anybody else's id is a 404, exactly like an unknown one). The return
 * page polls this: while the order is pending the gateway is asked what happened, so the page
 * updates within seconds even when no webhook arrives.
 */
export const GET = route<{ id: string }>(
  { auth: 'required', rateLimit: BILLING_READ_LIMIT },
  async (ctx) => {
    requireBrowserSession(ctx.auth);
    const { id } = ctx.params;
    const db = getDb();
    const notFound = () => AppError.of('not_found', 'Order not found');
    if (!isValidId(id, 'ord') || !findOwnedOrder(db, ctx.auth.user.id, id)) throw notFound();

    try {
      await refreshOrder(id, { minIntervalMs: POLL_MIN_INTERVAL_MS });
    } catch (error) {
      // A gateway hiccup must not break the poll: report what we have, the next poll tries again.
      getLogger().debug('Could not refresh a pending order', { module: 'billing', err: error });
    }
    const order = findOwnedOrder(db, ctx.auth.user.id, id);
    if (!order) throw notFound();
    return toOrderDTO(order);
  },
);
