import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DAY_MS } from '@/lib/billing/period';
import { createCheckout } from '@/server/billing/orders';
import { PAID_BATCH_SIZE, PAID_RECHECK_WINDOW_MS, tick } from '@/server/billing/scheduler';
import { settleOrder } from '@/server/billing/settle';
import { handleWebhook } from '@/server/billing/webhooks';
import { billingEvents, orders } from '@/server/db/schema';
import { expectConsistentLedger } from '../../helpers/credits';
import { billingTest } from './support';

const t = billingTest();
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
const HOUR = 60 * 60 * 1000;

/** A pack bought and paid at T0. */
async function paidPack(userId: string, id = 'pack-500') {
  const { order } = await createCheckout(
    userId,
    { type: 'pack', id },
    { idempotencyKey: `k-${Math.random()}`, now: T0 },
  );
  t.moyasar.pay(order.id);
  await settleOrder(order.id, { now: T0 });
  return order;
}

const invoiceReads = () => t.moyasar.callsTo('GET', /^\/invoices\//).length;

describe('a refund nobody announced is still found', () => {
  it('claws the credits back when the scheduler next looks at the paid order', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    expect(t.balance(user.id)).toBe(500);

    t.moyasar.refundOutside(order.id); // the owner refunds in the Moyasar dashboard; no webhook arrives
    const report = await tick(T0 + 7 * HOUR);

    expect(report.paidChecked).toBe(1);
    expect(t.order(order.id)).toMatchObject({
      status: 'refunded',
      refundedHalalas: order.amountHalalas,
      clawedBackCredits: 500,
    });
    expect(t.balance(user.id)).toBe(0);
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('also finds a chargeback that shows up as a voided payment, weeks later', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);

    t.moyasar.refundOutside(order.id, undefined, 'voided');
    await tick(T0 + 20 * DAY_MS);

    expect(t.order(order.id).status).toBe('refunded');
    expect(t.balance(user.id)).toBe(0);
  });

  it('finds a partial refund too, and the rest when it follows', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);

    t.moyasar.refundOutside(order.id, order.amountHalalas / 2);
    await tick(T0 + 7 * HOUR);
    expect(t.order(order.id)).toMatchObject({ status: 'paid', clawedBackCredits: 250 });
    expect(t.balance(user.id)).toBe(250);

    t.moyasar.refundOutside(order.id);
    await tick(T0 + 14 * HOUR);
    expect(t.order(order.id)).toMatchObject({ status: 'refunded', clawedBackCredits: 500 });
    expect(t.balance(user.id)).toBe(0);
  });

  it('a gateway outage costs a retry, not the refund', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    t.moyasar.refundOutside(order.id);

    t.moyasar.failNext(1, 503);
    const down = await tick(T0 + 7 * HOUR);
    expect(down.errors).toBeGreaterThan(0);
    expect(t.balance(user.id)).toBe(500);

    // The failed attempt is the pause; the next window finds it.
    await tick(T0 + 14 * HOUR);
    expect(t.balance(user.id)).toBe(0);
  });
});

describe('how often paid orders are asked about', () => {
  it('not within six hours of the last look, then every six hours while young', async () => {
    const user = t.newUser();
    await paidPack(user.id);
    const base = invoiceReads();

    await tick(T0 + 5 * HOUR);
    expect(invoiceReads()).toBe(base);

    const due = await tick(T0 + 6 * HOUR);
    expect(due.paidChecked).toBe(1);
    expect(invoiceReads()).toBe(base + 1);

    // The same moment again does nothing: the first tick claimed it.
    expect((await tick(T0 + 6 * HOUR)).paidChecked).toBe(0);
    expect((await tick(T0 + 11 * HOUR)).paidChecked).toBe(0);
    expect((await tick(T0 + 12 * HOUR)).paidChecked).toBe(1);
  });

  it('the older the order, the rarer the look: daily after a week, every third day after a month', async () => {
    const user = t.newUser();
    await paidPack(user.id);

    expect((await tick(T0 + 8 * DAY_MS)).paidChecked).toBe(1);
    expect((await tick(T0 + 8 * DAY_MS + 23 * HOUR)).paidChecked).toBe(0);
    expect((await tick(T0 + 9 * DAY_MS + 1000)).paidChecked).toBe(1);

    expect((await tick(T0 + 40 * DAY_MS)).paidChecked).toBe(1);
    expect((await tick(T0 + 42 * DAY_MS)).paidChecked).toBe(0);
    expect((await tick(T0 + 43 * DAY_MS + 1000)).paidChecked).toBe(1);
  });

  it('an order older than the window is left alone, and so is one that is fully refunded', async () => {
    const user = t.newUser();
    const old = await paidPack(user.id);
    const refunded = await paidPack(user.id);
    t.moyasar.refundOutside(refunded.id);
    await settleOrder(refunded.id, { now: T0 });
    expect(t.order(refunded.id).status).toBe('refunded');
    const base = invoiceReads();

    const report = await tick(T0 + PAID_RECHECK_WINDOW_MS + DAY_MS);

    expect(report.paidChecked).toBe(0);
    expect(invoiceReads()).toBe(base);
    expect(t.order(old.id).status).toBe('paid');
  });

  it('works through a backlog a few orders per tick, oldest look first', async () => {
    const user = t.newUser();
    const made = [] as string[];
    for (let i = 0; i < PAID_BATCH_SIZE + 2; i += 1) made.push((await paidPack(user.id)).id);

    const first = await tick(T0 + 7 * HOUR);
    const second = await tick(T0 + 7 * HOUR + 1000);

    expect(first.paidChecked).toBe(PAID_BATCH_SIZE);
    expect(second.paidChecked).toBe(2);
    const checked = t.db
      .select({ at: orders.lastCheckedAt })
      .from(orders)
      .all()
      .filter((row) => row.at !== null && row.at > T0);
    expect(checked).toHaveLength(PAID_BATCH_SIZE + 2);
  });
});

describe('a refund event that overtakes the data is retried, not lost', () => {
  const event = (orderId: string, type: string, eventId: string) =>
    t.moyasar.webhook(type, orderId, { eventId });
  const processedAt = (eventKey: string) =>
    t.db.select().from(billingEvents).where(eq(billingEvents.eventKey, eventKey)).get()
      ?.processedAt;

  it('stays open (answered with a retryable error) until the API shows the refund', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    const delivery = event(order.id, 'payment_refunded', 'evt-1');

    // The event arrives first; the invoice does not show a refund yet.
    await expect(handleWebhook(delivery, T0 + 1000)).rejects.toMatchObject({
      code: 'provider_error',
      status: 502,
      details: { reason: 'reversal_not_visible' },
    });
    expect(t.balance(user.id)).toBe(500);
    expect(processedAt('moyasar:evt-1')).toBeNull();

    // The gateway delivers it again, now the refund is visible.
    t.moyasar.refundOutside(order.id);
    await expect(handleWebhook(delivery, T0 + 2000)).resolves.toBe('processed');
    expect(t.order(order.id).status).toBe('refunded');
    expect(t.balance(user.id)).toBe(0);
    expect(processedAt('moyasar:evt-1')).not.toBeNull();

    // And a third delivery is a no-op.
    await expect(handleWebhook(delivery, T0 + 3000)).resolves.toBe('duplicate');
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('an event about another payment of the checkout (a voided attempt) is not retried', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    const delivery = event(order.id, 'payment_voided', 'evt-2');
    const body = JSON.parse(delivery.rawBody) as { data: { id: string } };
    body.data.id = 'some-other-attempt';

    await expect(
      handleWebhook({ headers: delivery.headers, rawBody: JSON.stringify(body) }, T0 + 1000),
    ).resolves.toBe('processed');
    expect(t.order(order.id).status).toBe('paid');
  });

  it('an ordinary payment event is processed at once', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k', now: T0 },
    );
    t.moyasar.pay(order.id);
    await expect(handleWebhook(event(order.id, 'payment_paid', 'evt-3'), T0)).resolves.toBe(
      'processed',
    );
    expect(t.balance(user.id)).toBe(500);
  });
});
