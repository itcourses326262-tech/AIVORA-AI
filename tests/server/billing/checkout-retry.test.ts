import { describe, expect, it } from 'vitest';
import { and, eq, isNotNull } from 'drizzle-orm';
import { DAY_MS } from '@/lib/billing/period';
import {
  MAX_CHECKOUTS_PER_DAY,
  MAX_PENDING_CHECKOUTS,
  createCheckout,
} from '@/server/billing/orders';
import { settleOrder } from '@/server/billing/settle';
import { orders, subscriptions } from '@/server/db/schema';
import { billingTest } from './support';

const t = billingTest();
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);

const pack = (userId: string, key: string, now = T0) =>
  createCheckout(userId, { type: 'pack', id: 'pack-500' }, { idempotencyKey: key, now });
const plan = (userId: string, id: string, key: string, now = T0) =>
  createCheckout(userId, { type: 'subscription', id }, { idempotencyKey: key, now });

describe('retrying a checkout that failed before any payment page existed', () => {
  it('starts a fresh checkout instead of handing back the dead order', async () => {
    const user = t.newUser();
    t.moyasar.failNext(1, 503);
    await expect(pack(user.id, 'same-key')).rejects.toMatchObject({ code: 'provider_error' });
    const [dead] = t.db.select().from(orders).where(eq(orders.userId, user.id)).all();
    expect(dead).toMatchObject({ status: 'failed', gatewayInvoiceId: null });

    const retry = await pack(user.id, 'same-key', T0 + 1000);

    expect(retry.created).toBe(true);
    expect(retry.order).toMatchObject({ status: 'pending' });
    expect(retry.order.id).not.toBe(dead?.id);
    expect(retry.order.checkoutUrl).toMatch(/^https:\/\//);
    // The dead order gave the key up; the new one carries it.
    expect(t.order(dead?.id ?? '').idempotencyKey).toBeNull();
    expect(t.order(retry.order.id).idempotencyKey).toBe('same-key');

    // From here on the key means this order, as always.
    const replay = await pack(user.id, 'same-key', T0 + 2000);
    expect(replay.created).toBe(false);
    expect(replay.order.id).toBe(retry.order.id);
  });

  it('a first month that failed at the gateway can be retried with the same key', async () => {
    const user = t.newUser();
    t.moyasar.failNext(1, 500);
    await expect(plan(user.id, 'pro', 'k')).rejects.toMatchObject({ code: 'provider_error' });
    expect(
      t.db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).get(),
    ).toMatchObject({ status: 'expired' });

    const retry = await plan(user.id, 'pro', 'k', T0 + 1000);

    expect(retry.created).toBe(true);
    expect(retry.order.checkoutUrl).not.toBeNull();
    const live = t.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, 'incomplete')))
      .all();
    expect(live).toHaveLength(1);
  });

  it('two retries at once make one checkout, not two', async () => {
    const user = t.newUser();
    t.moyasar.failNext(1, 503);
    await expect(pack(user.id, 'dup')).rejects.toThrow();

    const results = await Promise.allSettled([
      pack(user.id, 'dup', T0 + 1000),
      pack(user.id, 'dup', T0 + 1000),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const withKey = t.db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, user.id), isNotNull(orders.idempotencyKey)))
      .all();
    expect(withKey).toHaveLength(1);
    // The failed attempt and the one checkout that followed; the second retry created nothing.
    expect(t.moyasar.callsTo('POST', /^\/invoices$/)).toHaveLength(2);
  });

  it('an order that was offered to the buyer is replayed as it is, whatever happened to it', async () => {
    const user = t.newUser();
    const { order } = await pack(user.id, 'offered');
    t.moyasar.expire(order.id);
    await settleOrder(order.id);
    expect(t.order(order.id).status).toBe('failed');

    const replay = await pack(user.id, 'offered', T0 + 5000);

    expect(replay.created).toBe(false);
    expect(replay.order).toMatchObject({ id: order.id, status: 'failed' });
  });
});

describe('the number of checkouts one account may start in a day', () => {
  async function switchPlans(userId: string, count: number) {
    for (let i = 0; i < count; i += 1) {
      await plan(userId, i % 2 === 0 ? 'starter' : 'pro', `switch-${i}`, T0 + i * 1000);
    }
  }

  it('is limited even when every checkout closes the previous one', async () => {
    const user = t.newUser();
    await switchPlans(user.id, MAX_CHECKOUTS_PER_DAY);
    const invoicesBefore = t.moyasar.callsTo('POST', /^\/invoices$/).length;
    expect(invoicesBefore).toBe(MAX_CHECKOUTS_PER_DAY);

    await expect(plan(user.id, 'starter', 'one-too-many', T0 + 30_000)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      details: { reason: 'daily_checkout_limit', limit: MAX_CHECKOUTS_PER_DAY },
    });

    // Refused before anything was closed or created: the open checkout is still the buyer's.
    expect(t.moyasar.callsTo('POST', /^\/invoices$/)).toHaveLength(invoicesBefore);
    expect(t.moyasar.callsTo('PUT', /\/cancel$/)).toHaveLength(MAX_CHECKOUTS_PER_DAY - 1);
    const open = t.db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, user.id), eq(orders.status, 'pending')))
      .all();
    expect(open).toHaveLength(1);
  });

  it('says when to come back, and the oldest checkout falling out of the day frees one place', async () => {
    const user = t.newUser();
    await switchPlans(user.id, MAX_CHECKOUTS_PER_DAY);

    const error = await plan(user.id, 'starter', 'wait', T0 + 30_000).catch((e: unknown) => e);
    expect(error).toMatchObject({
      details: { retryAfterSec: Math.ceil((T0 + DAY_MS - (T0 + 30_000)) / 1000) },
    });

    const later = await plan(user.id, 'starter', 'later', T0 + DAY_MS + 1);
    expect(later.created).toBe(true);
  });

  it('replaying an earlier request is free', async () => {
    const user = t.newUser();
    await switchPlans(user.id, MAX_CHECKOUTS_PER_DAY);
    const replay = await plan(
      user.id,
      (MAX_CHECKOUTS_PER_DAY - 1) % 2 === 0 ? 'starter' : 'pro',
      `switch-${MAX_CHECKOUTS_PER_DAY - 1}`,
      T0 + 40_000,
    );
    expect(replay.created).toBe(false);
  });

  it('counts the account, not the plans: another account is not affected', async () => {
    const user = t.newUser();
    const other = t.newUser();
    await switchPlans(user.id, MAX_CHECKOUTS_PER_DAY);
    expect((await pack(other.id, 'fine', T0 + 1000)).created).toBe(true);
  });

  it('the limit on open checkouts still holds on its own', async () => {
    const user = t.newUser();
    // Open orders that cannot be handed out again (no payment page), as a crash would leave them.
    t.db
      .insert(orders)
      .values(
        Array.from({ length: MAX_PENDING_CHECKOUTS }, (_, index) => ({
          id: `ord_0000000000000000000000${String(index + 10).padStart(4, '0')}`,
          userId: user.id,
          kind: 'pack' as const,
          itemId: 'pack-500',
          amountHalalas: 2900,
          currency: 'SAR' as const,
          vatHalalas: 378,
          credits: 500,
          status: 'pending' as const,
          gateway: 'moyasar' as const,
          expiresAt: T0 + DAY_MS,
          createdAt: T0 + index,
          updatedAt: T0 + index,
        })),
      )
      .run();
    await expect(pack(user.id, 'sixth')).rejects.toMatchObject({ code: 'too_many_active' });
  });
});
