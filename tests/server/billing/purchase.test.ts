import { describe, expect, it } from 'vitest';
import { CREDIT_PACKS, getPack, splitVat } from '@/lib/billing/plans';
import { CHECKOUT_TTL_MS } from '@/lib/billing/period';
import { createCheckout } from '@/server/billing/orders';
import { settleOrder } from '@/server/billing/settle';
import { creditLedger } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { expectConsistentLedger } from '../../helpers/credits';
import { FAKE_API_BASE, FAKE_SECRET_KEY } from './fake-moyasar';
import { billingTest } from './support';

const t = billingTest();

function ledgerFor(userId: string) {
  return t.db.select().from(creditLedger).where(eq(creditLedger.userId, userId)).all();
}

describe('buying a credit pack', () => {
  it('creates a pending order priced by the server and a hosted payment page', async () => {
    const user = t.newUser();
    const pack = getPack('pack-500');
    if (!pack) throw new Error('pack-500 missing');

    const { order, created } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'key-1', now: 1_000_000 },
    );

    expect(created).toBe(true);
    expect(order).toMatchObject({
      userId: user.id,
      kind: 'pack',
      itemId: 'pack-500',
      amountHalalas: pack.priceHalalas,
      currency: 'SAR',
      credits: 500,
      status: 'pending',
      gateway: 'moyasar',
      subscriptionId: null,
      expiresAt: 1_000_000 + CHECKOUT_TTL_MS,
    });
    expect(order.vatHalalas).toBe(splitVat(pack.priceHalalas, 15).vatHalalas);
    expect(order.checkoutUrl).toMatch(/^https:\/\/checkout\.moyasar\.com\/invoices\//);

    const [call] = t.moyasar.callsTo('POST', /^\/invoices$/);
    expect(call?.authorization).toBe(
      `Basic ${Buffer.from(`${FAKE_SECRET_KEY}:`).toString('base64')}`,
    );
    expect(call?.body).toMatchObject({
      amount: pack.priceHalalas,
      currency: 'SAR',
      metadata: { order_id: order.id },
    });
    expect(JSON.stringify(call?.body)).not.toContain(user.email);
    expect(FAKE_API_BASE).toContain('moyasar.com');
  });

  it('credits the user once the gateway confirms the payment, and only then', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-1500' },
      { idempotencyKey: 'k' },
    );

    const before = await settleOrder(order.id);
    expect(before?.outcome).toBe('pending');
    expect(t.balance(user.id)).toBe(0);

    t.moyasar.pay(order.id);
    const result = await settleOrder(order.id);

    expect(result?.outcome).toBe('paid');
    expect(result?.order).toMatchObject({ status: 'paid' });
    expect(result?.order.paidAt).not.toBeNull();
    expect(result?.order.gatewayPaymentId).toEqual(expect.any(String));
    expect(t.balance(user.id)).toBe(CREDIT_PACKS[1].credits);
    const entries = ledgerFor(user.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      delta: 1500,
      reason: 'purchase',
      idempotencyKey: `order:${order.id}`,
    });
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('settling again, from any number of callers at once, credits exactly once', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k' },
    );
    t.moyasar.pay(order.id);

    const results = await Promise.all(Array.from({ length: 8 }, () => settleOrder(order.id)));

    expect(results.filter((result) => result?.outcome === 'paid')).toHaveLength(1);
    expect(results.every((result) => result?.order.status === 'paid')).toBe(true);
    expect(t.balance(user.id)).toBe(500);
    expect(ledgerFor(user.id)).toHaveLength(1);
    expect((await settleOrder(order.id))?.outcome).toBe('already_paid');
    expect(t.balance(user.id)).toBe(500);
  });

  it('a declined card attempt leaves the checkout payable, an expired one closes it', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k' },
    );

    t.moyasar.declineAttempt(order.id);
    expect((await settleOrder(order.id))?.outcome).toBe('pending');
    expect(t.order(order.id).status).toBe('pending');

    t.moyasar.expire(order.id);
    const closed = await settleOrder(order.id);
    expect(closed?.outcome).toBe('closed');
    expect(t.order(order.id).status).toBe('failed');
    expect(t.balance(user.id)).toBe(0);
  });

  it('a payment that arrives after the checkout was closed is still credited', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k' },
    );
    t.moyasar.expire(order.id);
    await settleOrder(order.id);
    expect(t.order(order.id).status).toBe('failed');

    // The gateway later reports the invoice as paid (a race on its side): the buyer must not lose out.
    const invoice = t.moyasar.invoiceOf(order.id);
    invoice.status = 'initiated';
    t.moyasar.pay(order.id);

    expect((await settleOrder(order.id))?.outcome).toBe('paid');
    expect(t.balance(user.id)).toBe(500);
  });
});
