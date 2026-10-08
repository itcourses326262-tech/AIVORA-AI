import 'server-only';
import { eq, or } from 'drizzle-orm';
import { newId } from '@/lib/id';
import { getDb, type Db } from '@/server/db';
import { billingEvents, orders, type OrderRow } from '@/server/db/schema';
import { getLogger } from '@/server/logger';
import { getGateway } from './config';
import type { GatewayWebhookEvent } from './gateway';
import { settleOrder } from './settle';

export type WebhookResult = 'processed' | 'duplicate' | 'ignored';

/** Which of our orders a webhook is about, by the ids it mentions. Only ever used to choose where to look. */
function orderForEvent(
  db: Db,
  gatewayId: string,
  event: GatewayWebhookEvent,
): OrderRow | undefined {
  const candidates = [
    event.invoiceId === null ? undefined : eq(orders.gatewayInvoiceId, event.invoiceId),
    event.paymentId === null ? undefined : eq(orders.gatewayPaymentId, event.paymentId),
    event.orderRef === null ? undefined : eq(orders.id, event.orderRef),
  ].filter((condition) => condition !== undefined);
  if (candidates.length === 0) return undefined;
  const rows = db
    .select()
    .from(orders)
    .where(or(...candidates))
    .all();
  const mine = rows.filter((row) => row.gateway === gatewayId);
  // Prefer the order whose gateway checkout the event names over one it merely references.
  return (
    mine.find((row) => row.gatewayInvoiceId !== null && row.gatewayInvoiceId === event.invoiceId) ??
    mine.find((row) => row.gatewayPaymentId !== null && row.gatewayPaymentId === event.paymentId) ??
    mine[0]
  );
}

/**
 * A payment gateway webhook. The delivery is authenticated by the gateway adapter (constant-time
 * secret check), recorded once per event key, and then used for one thing only: to learn which order
 * to re-check. The decision to credit or claw back is made by `settleOrder` from the gateway's
 * API, never from this body, so a forged, replayed, reordered or tampered delivery cannot change a balance.
 *
 * An event whose handling failed (the gateway was unreachable) stays unprocessed and the HTTP layer
 * answers 5xx, so the gateway delivers it again; a processed event is acknowledged without work.
 */
export async function handleWebhook(
  delivery: { headers: Headers; rawBody: string },
  now: number = Date.now(),
): Promise<WebhookResult> {
  const gateway = getGateway();
  const event = gateway.verifyWebhook(delivery);
  const db = getDb();

  db.insert(billingEvents)
    .values({
      id: newId('bev', now),
      gateway: gateway.id,
      eventKey: event.eventKey,
      type: event.type,
      payloadHash: event.payloadHash,
      receivedAt: now,
    })
    .onConflictDoNothing({ target: billingEvents.eventKey })
    .run();
  const recorded = db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.eventKey, event.eventKey))
    .get();
  if (!recorded) throw new Error('A webhook event vanished right after it was recorded');
  if (recorded.processedAt !== null) return 'duplicate';

  const order = orderForEvent(db, gateway.id, event);
  if (!order) {
    // Not one of ours (the same Moyasar account may also take other payments).
    getLogger().info('Ignoring a webhook for an unknown payment', {
      module: 'billing',
      type: event.type,
    });
    db.update(billingEvents)
      .set({ processedAt: now })
      .where(eq(billingEvents.id, recorded.id))
      .run();
    return 'ignored';
  }

  db.update(billingEvents)
    .set({ orderId: order.id })
    .where(eq(billingEvents.id, recorded.id))
    .run();
  await settleOrder(order.id, { now });
  db.update(billingEvents).set({ processedAt: now }).where(eq(billingEvents.id, recorded.id)).run();
  return 'processed';
}
