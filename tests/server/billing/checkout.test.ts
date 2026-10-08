import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ORPHAN_AFTER_MS, MAX_PENDING_CHECKOUTS, createCheckout } from '@/server/billing/orders';
import { tick } from '@/server/billing/scheduler';
import { orders, subscriptions, users } from '@/server/db/schema';
import { billingTest } from './support';

const t = billingTest();
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);

const allOrders = () => t.db.select().from(orders).all();

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
    for (let i = 0; i < MAX_PENDING_CHECKOUTS; i += 1) {
      await createCheckout(
        user.id,
        { type: 'pack', id: 'pack-500' },
        { idempotencyKey: `k${i}`, now: T0 + i },
      );
    }
    await expect(
      createCheckout(
        user.id,
        { type: 'pack', id: 'pack-500' },
        { idempotencyKey: 'one-too-many', now: T0 + 100 },
      ),
    ).rejects.toMatchObject({ code: 'too_many_active', status: 429 });
    expect(t.moyasar.callsTo('POST', /^\/invoices$/)).toHaveLength(MAX_PENDING_CHECKOUTS);
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
    // A retry with the same key now sees the failed order and the client picks a new key.
    const replay = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'crashed', now: now + ORPHAN_AFTER_MS + 2000 },
    );
    expect(replay.order.status).toBe('failed');
  });

  it('a replayed key of an old orphan closes it on the spot', async () => {
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

    expect(replay.created).toBe(false);
    expect(replay.order.status).toBe('failed');
  });
});
