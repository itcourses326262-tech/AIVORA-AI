import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ORPHAN_AFTER_MS, MAX_PENDING_CHECKOUTS, createCheckout } from '@/server/billing/orders';
import { tick } from '@/server/billing/scheduler';
import { orders, subscriptions, users } from '@/server/db/schema';
import { billingTest } from './support';

const t = billingTest();
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);

const allOrders = () => t.db.select().from(orders).all();

/** An unpaid pack order without a payment page: it counts as open but can never be handed out again. */
function insertPendingPack(userId: string, index: number) {
  t.db
    .insert(orders)
    .values({
      id: `ord_0000000000000000000000${String(index + 10).padStart(4, '0')}`,
      userId,
      kind: 'pack',
      itemId: 'pack-500',
      amountHalalas: 2900,
      currency: 'SAR',
      vatHalalas: 378,
      credits: 500,
      status: 'pending',
      gateway: 'moyasar',
      expiresAt: T0 + 24 * 60 * 60 * 1000,
      createdAt: T0 + index,
      updatedAt: T0 + index,
    })
    .run();
}

describe('createCheckout', () => {
  it('returns the original order for a retry with the same Idempotency-Key', async () => {
    const user = t.newUser();
    const first = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'same', now: T0 },
    );
    const second = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'same', now: T0 + 5000 },
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.checkoutUrl).toBe(first.order.checkoutUrl);
    expect(allOrders()).toHaveLength(1);
    expect(t.moyasar.callsTo('POST', /^\/invoices$/)).toHaveLength(1);
  });

  it('refuses the same key for another item (a client bug), and keys are per user', async () => {
    const alice = t.newUser();
    const bob = t.newUser();
    await createCheckout(
      alice.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'shared', now: T0 },
    );

    await expect(
      createCheckout(
        alice.id,
        { type: 'pack', id: 'pack-1500' },
        { idempotencyKey: 'shared', now: T0 },
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'idempotency_key_reused' } });
    await expect(
      createCheckout(
        alice.id,
        { type: 'subscription', id: 'pro' },
        { idempotencyKey: 'shared', now: T0 },
      ),
    ).rejects.toMatchObject({ code: 'conflict' });

    const other = await createCheckout(
      bob.id,
      { type: 'pack', id: 'pack-1500' },
      { idempotencyKey: 'shared', now: T0 },
    );
    expect(other.created).toBe(true);
    expect(other.order.userId).toBe(bob.id);
  });

  it('two simultaneous requests with one key create one order and one payment page', async () => {
    const user = t.newUser();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        createCheckout(
          user.id,
          { type: 'pack', id: 'pack-500' },
          { idempotencyKey: 'burst', now: T0 },
        ),
      ),
    );

    expect(allOrders()).toHaveLength(1);
    expect(t.moyasar.callsTo('POST', /^\/invoices$/)).toHaveLength(1);
    const winners = results.filter(
      (result) => result.status === 'fulfilled' && result.value.created,
    );
    expect(winners).toHaveLength(1);
    // The others either got the finished order back or were told to retry in a moment.
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({
          code: 'conflict',
          details: { reason: 'checkout_in_progress' },
        });
      }
    }
  });

  it('only ever uses the server price list: unknown items are 404', async () => {
    const user = t.newUser();
    for (const request of [
      { type: 'pack', id: 'pack-999999' },
      { type: 'pack', id: 'pro' },
      { type: 'subscription', id: 'pack-500' },
      { type: 'pack', id: '' },
    ] as const) {
      await expect(
        createCheckout(user.id, request, { idempotencyKey: 'k', now: T0 }),
      ).rejects.toMatchObject({
        code: 'not_found',
      });
    }
    expect(allOrders()).toEqual([]);
    expect(t.moyasar.calls).toEqual([]);
  });

  it('a disabled or unknown account cannot buy', async () => {
    const disabled = t.newUser();
    t.db.update(users).set({ disabledAt: T0 }).where(eq(users.id, disabled.id)).run();
    await expect(
      createCheckout(
        disabled.id,
        { type: 'pack', id: 'pack-500' },
        { idempotencyKey: 'k', now: T0 },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      createCheckout(
        'usr_00000000000000000000000000',
        { type: 'pack', id: 'pack-500' },
        { idempotencyKey: 'k', now: T0 },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('limits how many unpaid checkouts one account can hold', async () => {
    const user = t.newUser();
    // Five open orders that cannot be handed out again (no payment page), as a crash would leave.
    for (let i = 0; i < MAX_PENDING_CHECKOUTS; i += 1) insertPendingPack(user.id, i);

    await expect(
      createCheckout(
        user.id,
        { type: 'pack', id: 'pack-500' },
        { idempotencyKey: 'one-too-many', now: T0 + 100 },
      ),
    ).rejects.toMatchObject({ code: 'too_many_active', status: 429 });
    expect(t.moyasar.callsTo('POST', /^\/invoices$/)).toHaveLength(0);
  });

  it('a gateway failure fails the order cleanly and a plan checkout frees the account', async () => {
    const user = t.newUser();
    t.moyasar.failNext(1, 500);

    await expect(
      createCheckout(
        user.id,
        { type: 'subscription', id: 'pro' },
        { idempotencyKey: 'k', now: T0 },
      ),
    ).rejects.toMatchObject({ code: 'provider_error', status: 502 });

    expect(allOrders().map((order) => order.status)).toEqual(['failed']);
    expect(
      t.db
        .select()
        .from(subscriptions)
        .all()
        .map((row) => row.status),
    ).toEqual(['expired']);
    expect(allOrders()[0]?.gatewayInvoiceId).toBeNull();

    const retry = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'k2', now: T0 },
    );
    expect(retry.created).toBe(true);
  });

  it('the gateway refusing to answer is an error, not a hang or a paid order', async () => {
    const user = t.newUser();
    t.moyasar.failNext(1, 0);
    await expect(
      createCheckout(user.id, { type: 'pack', id: 'pack-500' }, { idempotencyKey: 'k', now: T0 }),
    ).rejects.toMatchObject({ code: 'provider_error', status: 502 });
    expect(t.balance(user.id)).toBe(0);
  });
});

describe('coming back to a pack that is already open', () => {
  const pack = (userId: string, key: string, id = 'pack-500', now = T0) =>
    createCheckout(userId, { type: 'pack', id }, { idempotencyKey: key, now });

  it('hands out the open payment page again instead of making another order', async () => {
    const user = t.newUser();
    const first = await pack(user.id, 'click-1');
    const again = await pack(user.id, 'click-2', 'pack-500', T0 + 60_000);
    const third = await pack(user.id, 'click-3', 'pack-500', T0 + 120_000);

    expect(first.created).toBe(true);
    expect([again.created, third.created]).toEqual([false, false]);
    expect(again.order.id).toBe(first.order.id);
    expect(third.order.checkoutUrl).toBe(first.order.checkoutUrl);
    expect(allOrders()).toHaveLength(1);
    expect(t.moyasar.callsTo('POST', /^\/invoices$/)).toHaveLength(1);
  });

  it('never locks the buyer out: any number of clicks on one pack stay one open order', async () => {
    const user = t.newUser();
    for (let i = 0; i < MAX_PENDING_CHECKOUTS * 3; i += 1) await pack(user.id, `k-${i}`);
    expect(allOrders()).toHaveLength(1);
  });

  it('keeps different packs, and a plan, apart', async () => {
    const user = t.newUser();
    const small = await pack(user.id, 'a', 'pack-500');
    const medium = await pack(user.id, 'b', 'pack-1500');
    const plan = await createCheckout(
      user.id,
      { type: 'subscription', id: 'starter' },
      { idempotencyKey: 'c', now: T0 },
    );
    expect(new Set([small.order.id, medium.order.id, plan.order.id]).size).toBe(3);
    expect(allOrders()).toHaveLength(3);
  });

  it('is per account', async () => {
    const alice = t.newUser();
    const bob = t.newUser();
    const a = await pack(alice.id, 'k');
    const b = await pack(bob.id, 'k2');
    expect(b.created).toBe(true);
    expect(b.order.id).not.toBe(a.order.id);
  });

  it('starts a new order once the old one is paid, closed or about to close', async () => {
    const user = t.newUser();
    const first = await pack(user.id, 'k1');
    // Paid (the webhook has not arrived yet): the click is told what is true, and is not a second order.
    t.moyasar.pay(first.order.id);
    const afterPaid = await pack(user.id, 'k2', 'pack-500', T0 + 1000);
    expect(afterPaid.created).toBe(false);
    expect(afterPaid.order).toMatchObject({ id: first.order.id, status: 'paid' });
    expect(t.balance(user.id)).toBe(500);
    // Once it is settled, the next click is a new purchase.
    const another = await pack(user.id, 'k2b', 'pack-500', T0 + 2000);
    expect(another.created).toBe(true);

    // Its page closes within the next half hour: a buyer must not be sent to it.
    const nearlyOver = await pack(user.id, 'k3', 'pack-1500', T0);
    const soon = T0 + 24 * 60 * 60 * 1000 - 10 * 60 * 1000;
    const next = await pack(user.id, 'k4', 'pack-1500', soon);
    expect(next.created).toBe(true);
    expect(next.order.id).not.toBe(nearlyOver.order.id);
  });

  it('starts a new order when the open one was closed at the gateway in the meantime', async () => {
    const user = t.newUser();
    const first = await pack(user.id, 'k1');
    t.moyasar.expire(first.order.id);
    const again = await pack(user.id, 'k2', 'pack-500', T0 + 10_000);
    expect(again.created).toBe(true);
    expect(again.order.id).not.toBe(first.order.id);
    expect(t.order(first.order.id).status).not.toBe('pending');
  });

  it('still hands the open one out when the gateway cannot be asked', async () => {
    const user = t.newUser();
    const first = await pack(user.id, 'k1');
    t.moyasar.failNext(1, 503);
    const again = await pack(user.id, 'k2', 'pack-500', T0 + 10_000);
    expect(again.order.id).toBe(first.order.id);
    expect(again.created).toBe(false);
  });

  it('starts a new order when the price list has changed since the open one was made', async () => {
    const user = t.newUser();
    const first = await pack(user.id, 'k1');
    t.db.update(orders).set({ amountHalalas: 2500 }).where(eq(orders.id, first.order.id)).run();
    const again = await pack(user.id, 'k2', 'pack-500', T0 + 1000);
    expect(again.created).toBe(true);
    expect(again.order.amountHalalas).toBe(2900);
  });

  it('does not count the returned checkout as a new one against the daily limit', async () => {
    const user = t.newUser();
    for (let i = 0; i < 30; i += 1) await pack(user.id, `k-${i}`, 'pack-500', T0 + i);
    expect(allOrders()).toHaveLength(1);
  });
});

describe('crash leftovers', () => {
  it('an order that never got a payment page is closed by the scheduler, never payable', async () => {
    const user = t.newUser();
    const now = T0;
    t.db
      .insert(orders)
      .values({
        id: 'ord_00000000000000000000000001',
        userId: user.id,
        kind: 'pack',
        itemId: 'pack-500',
        amountHalalas: 2900,
        currency: 'SAR',
        vatHalalas: 378,
        credits: 500,
        status: 'pending',
        gateway: 'moyasar',
        idempotencyKey: 'crashed',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Still young: a request may be in flight.
    await expect(
      createCheckout(
        user.id,
        { type: 'pack', id: 'pack-500' },
        { idempotencyKey: 'crashed', now: now + 1000 },
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'checkout_in_progress' } });

    const report = await tick(now + ORPHAN_AFTER_MS + 1000);

    expect(report.orphansClosed).toBe(1);
    expect(t.order('ord_00000000000000000000000001').status).toBe('failed');
    // A retry with the same key does not get the dead order back: it starts a fresh checkout.
    const retry = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'crashed', now: now + ORPHAN_AFTER_MS + 2000 },
    );
    expect(retry.created).toBe(true);
    expect(retry.order).toMatchObject({ status: 'pending' });
    expect(retry.order.id).not.toBe('ord_00000000000000000000000001');
    expect(retry.order.checkoutUrl).not.toBeNull();
    expect(t.order('ord_00000000000000000000000001')).toMatchObject({
      status: 'failed',
      idempotencyKey: null,
    });
  });

  it('a replayed key of an old orphan closes it on the spot and starts a fresh checkout', async () => {
    const user = t.newUser();
    t.db
      .insert(orders)
      .values({
        id: 'ord_00000000000000000000000002',
        userId: user.id,
        kind: 'pack',
        itemId: 'pack-500',
        amountHalalas: 2900,
        currency: 'SAR',
        vatHalalas: 378,
        credits: 500,
        status: 'pending',
        gateway: 'moyasar',
        idempotencyKey: 'old',
        createdAt: T0,
        updatedAt: T0,
      })
      .run();

    const replay = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'old', now: T0 + ORPHAN_AFTER_MS + 5 },
    );

    expect(replay.created).toBe(true);
    expect(replay.order).toMatchObject({ status: 'pending' });
    expect(replay.order.id).not.toBe('ord_00000000000000000000000002');
    expect(t.order('ord_00000000000000000000000002').status).toBe('failed');
  });
});
