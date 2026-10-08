import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DAY_MS, RENEWAL_GRACE_MS, RENEWAL_LEAD_MS, addMonthsUtc } from '@/lib/billing/period';
import { createCheckout } from '@/server/billing/orders';
import { refundOrder } from '@/server/billing/refunds';
import { tick } from '@/server/billing/scheduler';
import { settleOrder } from '@/server/billing/settle';
import {
  cancelSubscription,
  currentSubscription,
  resumeSubscription,
} from '@/server/billing/subscriptions';
import { orders, subscriptions, type OrderRow, type SubscriptionRow } from '@/server/db/schema';
import { expectConsistentLedger } from '../../helpers/credits';
import { billingTest } from './support';

const t = billingTest();
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
const END1 = addMonthsUtc(T0, 1, 8);
const END2 = addMonthsUtc(END1, 1, 8);

const subOf = (userId: string): SubscriptionRow => {
  const row = t.db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get();
  if (!row) throw new Error('no subscription');
  return row;
};
const ordersOf = (userId: string, kind?: OrderRow['kind']) =>
  t.db
    .select()
    .from(orders)
    .where(kind ? and(eq(orders.userId, userId), eq(orders.kind, kind)) : eq(orders.userId, userId))
    .all();

/** Subscribes to `pro` at T0 and pays the first month. */
async function subscribe(userId: string, plan = 'pro') {
  const { order } = await createCheckout(
    userId,
    { type: 'subscription', id: plan },
    { idempotencyKey: `k-${plan}`, now: T0 },
  );
  t.moyasar.pay(order.id);
  await settleOrder(order.id, { now: T0 });
  return order;
}

describe('starting a subscription', () => {
  it('is incomplete until the first month is paid, then runs for one calendar month', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'k', now: T0 },
    );

    expect(order).toMatchObject({
      kind: 'subscription_initial',
      credits: 3000,
      amountHalalas: 13900,
    });
    expect(subOf(user.id)).toMatchObject({
      status: 'incomplete',
      planId: 'pro',
      currentPeriodEnd: null,
    });
    expect(currentSubscription(user.id, T0)?.pendingOrder?.checkoutUrl).toBe(order.checkoutUrl);

    t.moyasar.pay(order.id);
    await settleOrder(order.id, { now: T0 });

    expect(subOf(user.id)).toMatchObject({
      status: 'active',
      anchorDay: 8,
      currentPeriodStart: T0,
      currentPeriodEnd: END1,
      nextChargeAt: END1 - RENEWAL_LEAD_MS,
      cancelAtPeriodEnd: false,
    });
    expect(t.balance(user.id)).toBe(3000);
    expect(t.order(order.id)).toMatchObject({ status: 'paid', periodStart: T0, periodEnd: END1 });
    expect(currentSubscription(user.id, T0)?.pendingOrder).toBeUndefined();
  });

  it('a failed or abandoned first month leaves no subscription behind', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'subscription', id: 'starter' },
      { idempotencyKey: 'k', now: T0 },
    );
    t.moyasar.expire(order.id);
    await settleOrder(order.id, { now: T0 + DAY_MS });

    expect(subOf(user.id).status).toBe('expired');
    const again = await createCheckout(
      user.id,
      { type: 'subscription', id: 'starter' },
      { idempotencyKey: 'k2', now: T0 + DAY_MS },
    );
    expect(again.created).toBe(true);
  });

  it('allows one subscription per account', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await expect(
      createCheckout(
        user.id,
        { type: 'subscription', id: 'studio' },
        { idempotencyKey: 'other', now: T0 },
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'subscription_exists' } });
    // Buying a pack is a different matter.
    const pack = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'pack', now: T0 },
    );
    expect(pack.created).toBe(true);
  });

  it('re-opening the same plan returns the open checkout; another plan replaces it', async () => {
    const user = t.newUser();
    const first = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'a', now: T0 },
    );
    const same = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'b', now: T0 + 1000 },
    );
    expect(same.created).toBe(false);
    expect(same.order.id).toBe(first.order.id);

    const other = await createCheckout(
      user.id,
      { type: 'subscription', id: 'studio' },
      { idempotencyKey: 'c', now: T0 + 2000 },
    );
    expect(other.created).toBe(true);
    expect(other.order.id).not.toBe(first.order.id);
    expect(t.order(first.order.id).status).toBe('canceled');
    expect(t.moyasar.callsTo('PUT', /\/cancel$/)).toHaveLength(1);
  });

  it('paying the abandoned plan in the last moment is not lost: the subscription runs', async () => {
    const user = t.newUser();
    const first = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'a', now: T0 },
    );
    t.moyasar.pay(first.order.id);

    await expect(
      createCheckout(
        user.id,
        { type: 'subscription', id: 'studio' },
        { idempotencyKey: 'b', now: T0 },
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'subscription_exists' } });

    expect(subOf(user.id)).toMatchObject({ status: 'active', planId: 'pro' });
    expect(t.balance(user.id)).toBe(3000);
  });
});

describe('renewing', () => {
  it('issues the payment link three days before the month ends, and the payment extends it', async () => {
    const user = t.newUser();
    await subscribe(user.id);

    await tick(T0 + 10 * DAY_MS);
    expect(ordersOf(user.id, 'subscription_renewal')).toEqual([]);

    const report = await tick(END1 - RENEWAL_LEAD_MS + 1000);
    expect(report.errors).toBe(0);
    const [renewal] = ordersOf(user.id, 'subscription_renewal');
    expect(renewal).toMatchObject({
      status: 'pending',
      amountHalalas: 13900,
      credits: 3000,
      subscriptionId: subOf(user.id).id,
      expiresAt: END1 + RENEWAL_GRACE_MS,
    });
    expect(renewal?.checkoutUrl).toMatch(/^https:\/\//);
    expect(subOf(user.id)).toMatchObject({ status: 'active', nextChargeAt: END1 });
    expect(currentSubscription(user.id, END1 - DAY_MS)?.pendingOrder?.id).toBe(renewal?.id);

    // Another tick does not issue a second link.
    await tick(END1 - RENEWAL_LEAD_MS + 60_000);
    expect(ordersOf(user.id, 'subscription_renewal')).toHaveLength(1);

    t.moyasar.pay(renewal?.id ?? '');
    await settleOrder(renewal?.id ?? '', { now: END1 - DAY_MS });

    expect(subOf(user.id)).toMatchObject({
      status: 'active',
      currentPeriodStart: END1,
      currentPeriodEnd: END2,
      nextChargeAt: END2 - RENEWAL_LEAD_MS,
    });
    expect(t.balance(user.id)).toBe(6000);
    expect(t.order(renewal?.id ?? '')).toMatchObject({
      status: 'paid',
      periodStart: END1,
      periodEnd: END2,
    });
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('unpaid: past due at the end of the month, expired when the grace period is over', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    const [renewal] = ordersOf(user.id, 'subscription_renewal');

    await tick(END1 + 1000);
    expect(subOf(user.id)).toMatchObject({
      status: 'past_due',
      nextChargeAt: END1 + RENEWAL_GRACE_MS,
    });
    expect(t.order(renewal?.id ?? '').status).toBe('pending');
    expect(t.balance(user.id)).toBe(3000);

    await tick(END1 + 3 * DAY_MS);
    expect(subOf(user.id).status).toBe('past_due');

    await tick(END1 + RENEWAL_GRACE_MS + 1000);
    expect(subOf(user.id)).toMatchObject({ status: 'expired', nextChargeAt: null });
    expect(t.order(renewal?.id ?? '').status).toBe('failed');
    expect(t.moyasar.callsTo('PUT', /\/cancel$/)).toHaveLength(1);
    // Credits already granted are never taken away for non-payment.
    expect(t.balance(user.id)).toBe(3000);

    const again = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'again', now: END1 + 9 * DAY_MS },
    );
    expect(again.created).toBe(true);
  });

  it('paying during the grace period continues from the end of the old month', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    await tick(END1 + 1000);
    expect(subOf(user.id).status).toBe('past_due');
    const [renewal] = ordersOf(user.id, 'subscription_renewal');

    t.moyasar.pay(renewal?.id ?? '');
    await settleOrder(renewal?.id ?? '', { now: END1 + 4 * DAY_MS });

    expect(subOf(user.id)).toMatchObject({
      status: 'active',
      currentPeriodStart: END1,
      currentPeriodEnd: END2,
    });
    expect(t.balance(user.id)).toBe(6000);
  });

  it('a scheduler that was down still issues the link and then marks it past due', async () => {
    const user = t.newUser();
    await subscribe(user.id);

    await tick(END1 + DAY_MS);
    expect(ordersOf(user.id, 'subscription_renewal')).toHaveLength(1);
    await tick(END1 + DAY_MS + 60_000);
    expect(subOf(user.id).status).toBe('past_due');
  });

  it('a failed gateway call while issuing the link is retried by a later tick', async () => {
    const user = t.newUser();
    await subscribe(user.id);

    t.moyasar.failNext(1, 503);
    const first = await tick(END1 - RENEWAL_LEAD_MS + 1000);
    expect(first.errors).toBeGreaterThan(0);
    expect(ordersOf(user.id, 'subscription_renewal').map((order) => order.status)).toEqual([
      'failed',
    ]);

    // The claim is a lease: once it runs out the next tick tries again and succeeds.
    await tick(END1 - RENEWAL_LEAD_MS + 10 * 60 * 1000);
    expect(
      ordersOf(user.id, 'subscription_renewal')
        .map((order) => order.status)
        .sort(),
    ).toEqual(['failed', 'pending']);
  });

  it('renews at the current price of the plan', async () => {
    const user = t.newUser();
    await subscribe(user.id, 'starter');
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    const [renewal] = ordersOf(user.id, 'subscription_renewal');
    expect(renewal).toMatchObject({ itemId: 'starter', amountHalalas: 4900, credits: 1000 });
  });
});

describe('canceling and resuming', () => {
  it('cancel keeps the paid month, withdraws the renewal link and ends it at the end of the month', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    const [renewal] = ordersOf(user.id, 'subscription_renewal');

    const dto = await cancelSubscription(user.id, END1 - 2 * DAY_MS);
    expect(dto).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    expect(dto.pendingOrder).toBeUndefined();
    expect(t.order(renewal?.id ?? '').status).toBe('canceled');
    expect(subOf(user.id).nextChargeAt).toBe(END1);

    // Idempotent.
    await cancelSubscription(user.id, END1 - 2 * DAY_MS);

    await tick(END1 + 1000);
    expect(subOf(user.id)).toMatchObject({
      status: 'canceled',
      canceledAt: END1 + 1000,
      nextChargeAt: null,
    });
    expect(ordersOf(user.id, 'subscription_renewal')).toHaveLength(1);
    expect(t.balance(user.id)).toBe(3000);
  });

  it('resume before the month ends brings the renewal back', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await cancelSubscription(user.id, T0 + DAY_MS);

    const resumed = resumeSubscription(user.id, T0 + 2 * DAY_MS);
    expect(resumed).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
    expect(subOf(user.id).nextChargeAt).toBe(END1 - RENEWAL_LEAD_MS);

    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    expect(ordersOf(user.id, 'subscription_renewal')).toHaveLength(1);
  });

  it('cannot resume once the subscription ended, or one that does not exist', async () => {
    const user = t.newUser();
    expect(() => resumeSubscription(user.id, T0)).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    );
    await expect(cancelSubscription(user.id, T0)).rejects.toMatchObject({ code: 'not_found' });

    await subscribe(user.id);
    await cancelSubscription(user.id, T0 + DAY_MS);
    await tick(END1 + 1000);
    expect(() => resumeSubscription(user.id, END1 + 2000)).toThrow(
      expect.objectContaining({ code: 'conflict', details: { reason: 'subscription_ended' } }),
    );
  });

  it('canceling while the first month is unpaid abandons the checkout', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'k', now: T0 },
    );

    const dto = await cancelSubscription(user.id, T0 + 1000);

    expect(dto.status).toBe('canceled');
    expect(t.order(order.id).status).toBe('canceled');
    expect(t.balance(user.id)).toBe(0);
  });

  it('canceling while past due ends it at once', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    await tick(END1 + 1000);

    const dto = await cancelSubscription(user.id, END1 + 2000);

    expect(dto.status).toBe('canceled');
    expect(
      ordersOf(user.id, 'subscription_renewal').every((order) => order.status === 'canceled'),
    ).toBe(true);
  });

  it('a renewal paid at the very moment of cancellation is not lost', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    const [renewal] = ordersOf(user.id, 'subscription_renewal');
    t.moyasar.pay(renewal?.id ?? '');

    await cancelSubscription(user.id, END1 - DAY_MS);

    expect(t.order(renewal?.id ?? '').status).toBe('paid');
    expect(t.balance(user.id)).toBe(6000);
    expect(subOf(user.id)).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: END2,
    });
  });
});

describe('refunds of subscription payments', () => {
  it('refunding the payment of the current month ends the subscription now', async () => {
    const user = t.newUser();
    const first = await subscribe(user.id);

    await refundOrder(first.id, { now: T0 + DAY_MS });

    expect(subOf(user.id)).toMatchObject({ status: 'canceled', nextChargeAt: null });
    expect(t.balance(user.id)).toBe(0);
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('refunding an older month leaves the running subscription alone', async () => {
    const user = t.newUser();
    const first = await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    const [renewal] = ordersOf(user.id, 'subscription_renewal');
    t.moyasar.pay(renewal?.id ?? '');
    await settleOrder(renewal?.id ?? '', { now: END1 });

    await refundOrder(first.id, { now: END1 + 1000 });

    expect(subOf(user.id)).toMatchObject({ status: 'active', currentPeriodEnd: END2 });
    expect(t.balance(user.id)).toBe(3000);
  });

  it('a withdrawn renewal link of an ended subscription is cleaned up by the scheduler', async () => {
    const user = t.newUser();
    const first = await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    const [renewal] = ordersOf(user.id, 'subscription_renewal');

    await refundOrder(first.id, { now: END1 - 2 * DAY_MS });
    expect(t.order(renewal?.id ?? '').status).toBe('pending');
    await tick(END1 - 2 * DAY_MS + 60_000);

    expect(t.order(renewal?.id ?? '').status).toBe('canceled');
  });
});
