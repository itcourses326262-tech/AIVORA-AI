import { addressRoute } from '@/server/auth/address-route';
import { handleWebhook } from '@/server/billing/webhooks';
import { ok } from '@/server/http/respond';
import { WEBHOOK_LIMITS } from '../../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Payment gateway webhook. No session and no CSRF check (the caller is the gateway, authenticated
 * by the shared secret inside the body, compared in constant time). The body is only used to find
 * the order to re-check; credits move only after the gateway's API has confirmed the payment, so
 * a forged, replayed or reordered delivery is harmless. 2xx = handled or safely ignorable, 401 =
 * not authentic, 5xx = try again later (the gateway retries a few times over two hours).
 */
export const POST = addressRoute(
  { auth: 'none', maxBodyBytes: 64 * 1024 },
  WEBHOOK_LIMITS,
  async (ctx) => {
    const rawBody = await ctx.req.text();
    const result = await handleWebhook({ headers: ctx.req.headers, rawBody });
    return ok({ received: true, result });
  },
);
