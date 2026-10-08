import { z } from 'zod';
import { PURCHASE_TYPES } from '@/lib/billing/types';
import { toOrderDTO } from '@/server/billing/dto';
import { requireBrowserSession, requireIdempotencyKey } from '@/server/billing/guards';
import { createCheckout } from '@/server/billing/orders';
import { created, ok } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { CHECKOUT_LIMIT } from '../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Strict on purpose: a body that names an amount, a currency or credits is refused, not ignored. */
const checkoutSchema = z.strictObject({
  type: z.enum(PURCHASE_TYPES),
  id: z.string().min(1).max(64),
});

/**
 * Starts buying a credit pack or a plan: 201 with the pending order, whose `checkoutUrl` is where
 * the buyer pays (the gateway's hosted page). Needs the `Idempotency-Key` header; a retry with the
 * same key returns the same order with 200. Only a browser session may buy, never an API key, and
 * the price is the server's, whatever the client believes.
 */
export const POST = route(
  { auth: 'required', rateLimit: CHECKOUT_LIMIT, maxBodyBytes: 4 * 1024 },
  async (ctx) => {
    requireBrowserSession(ctx.auth);
    const idempotencyKey = requireIdempotencyKey(ctx.req);
    const body = await ctx.body(checkoutSchema);
    const { order, created: isNew } = await createCheckout(ctx.auth.user.id, body, {
      idempotencyKey,
    });
    const dto = toOrderDTO(order);
    const location = `/api/v1/billing/orders/${order.id}`;
    return isNew
      ? created(dto, { headers: { Location: location } })
      : ok(dto, { headers: { Location: location, 'Idempotent-Replayed': 'true' } });
  },
);
