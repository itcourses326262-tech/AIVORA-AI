import { describe, expect, it } from 'vitest';
import { debitCredits } from '@/server/credits';
import { createCheckout } from '@/server/billing/orders';
import { refundOrder } from '@/server/billing/refunds';
import { settleOrder } from '@/server/billing/settle';
import { creditLedger } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { expectConsistentLedger } from '../../helpers/credits';
import { createGeneration } from '../../helpers/factories';
import { billingTest } from './support';

const t = billingTest();

async function buy(userId: string, id = 'pack-500', key = `k-${Math.random()}`) {
  const { order } = await createCheckout(userId, { type: 'pack', id }, { idempotencyKey: key });
  return order;
}

/** Spends credits the way a generation does, so the ledger stays a valid chain. */
function spend(userId: string, amount: number) {
  const generation = createGeneration(t.db, { userId });
  debitCredits(t.db, { userId, amount, generationId: generation.id });
}

describe('a payment that does not match its order is never credited', () => {
  it.each([
    ['a smaller amount', { amount: 100 }],
    ['a larger amount', { amount: 999_999 }],
    ['another currency', { currency: 'USD' }],
    ['another order reference', { orderRef: 'ord_00000000000000000000000000' }],
    ['no order reference', { orderRef: null }],
  ])('%s', async (_name, odd) => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id, odd);

    const result = await settleOrder(order.id);

    expect(result?.outcome).toBe('needs_review');
    expect(t.order(order.id)).toMatchObject({ status: 'needs_review', paidAt: null });
    expect(t.balance(user.id)).toBe(0);
    expect(t.db.select().from(creditLedger).where(eq(creditLedger.userId, user.id)).all()).toEqual(
      [],
    );
    // Asking again does not change its mind.
    expect((await settleOrder(order.id))?.outcome).toBe('unchanged');
    expect(t.balance(user.id)).toBe(0);
  });

  it('a mismatched first month leaves no running subscription behind', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'k' },
    );
    t.moyasar.pay(order.id, { amount: 1 });

    await settleOrder(order.id);

    const next = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'k2' },
    );
    expect(next.created).toBe(true);
  });
});

describe('refunds and chargebacks take the credits back', () => {
  it('a full refund started by the operator returns the money and the credits, once', async () => {
    const user = t.newUser();
    const order = await buy(user.id, 'pack-1500');
    t.moyasar.pay(order.id);
    await settleOrder(order.id);
    expect(t.balance(user.id)).toBe(1500);

    const refunded = await refundOrder(order.id);

    expect(refunded.order).toMatchObject({
      status: 'refunded',
      refundedHalalas: order.amountHalalas,
      clawedBackCredits: 1500,
    });
    expect(t.balance(user.id)).toBe(0);
    const [call] = t.moyasar.callsTo('POST', /\/refund$/);
    expect(call?.body).toEqual({ amount: order.amountHalalas });
    expectConsistentLedger(t.db, user.id, 0);

    // The same refund again (or a webhook about it) changes nothing.
    expect((await settleOrder(order.id))?.order.status).toBe('refunded');
    await expect(refundOrder(order.id)).rejects.toMatchObject({ code: 'bad_request' });
    expect(t.balance(user.id)).toBe(0);
    expect(
      t.db.select().from(creditLedger).where(eq(creditLedger.userId, user.id)).all(),
    ).toHaveLength(2);
  });

  it('a refund made in the dashboard (or a chargeback) is applied when we next look', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);
    await settleOrder(order.id);

    t.moyasar.refundOutside(order.id, undefined, 'voided');
    const result = await settleOrder(order.id);

    expect(result?.outcome).toBe('refunded');
    expect(t.balance(user.id)).toBe(0);
    expect(t.order(order.id).status).toBe('refunded');
  });

  it('a partial refund takes back the matching share of the credits', async () => {
    const user = t.newUser();
    const order = await buy(user.id, 'pack-500');
    t.moyasar.pay(order.id);
    await settleOrder(order.id);

    await refundOrder(order.id, { amountHalalas: order.amountHalalas / 2 });

    expect(t.order(order.id)).toMatchObject({
      status: 'paid',
      refundedHalalas: order.amountHalalas / 2,
      clawedBackCredits: 250,
    });
    expect(t.balance(user.id)).toBe(250);

    // The rest later completes it.
    await refundOrder(order.id);
    expect(t.order(order.id)).toMatchObject({ status: 'refunded', clawedBackCredits: 500 });
    expect(t.balance(user.id)).toBe(0);
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('credits already spent are not recovered: the balance stops at zero and the order is flagged', async () => {
    const user = t.newUser();
    const order = await buy(user.id, 'pack-500');
    t.moyasar.pay(order.id);
    await settleOrder(order.id);
    spend(user.id, 420);
    expect(t.balance(user.id)).toBe(80);

    const result = await refundOrder(order.id);

    expect(result.order).toMatchObject({
      status: 'needs_review',
      refundedHalalas: order.amountHalalas,
      clawedBackCredits: 80,
    });
    expect(t.balance(user.id)).toBe(0);
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('a user with nothing left loses nothing below zero and the order needs review', async () => {
    const user = t.newUser();
    const order = await buy(user.id, 'pack-500');
    t.moyasar.pay(order.id);
    await settleOrder(order.id);
    spend(user.id, 500);

    t.moyasar.refundOutside(order.id);
    const result = await settleOrder(order.id);

    expect(result?.order).toMatchObject({ status: 'needs_review', clawedBackCredits: 0 });
    expect(t.balance(user.id)).toBe(0);
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('a payment refunded before we ever credited it is never credited', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);
    t.moyasar.refundOutside(order.id);

    const result = await settleOrder(order.id);

    expect(result?.outcome).toBe('refunded');
    expect(t.order(order.id)).toMatchObject({ status: 'refunded', paidAt: null });
    expect(t.balance(user.id)).toBe(0);
    expect(t.db.select().from(creditLedger).where(eq(creditLedger.userId, user.id)).all()).toEqual(
      [],
    );
  });

  it('refuses to refund what was never paid or more than was paid', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    await expect(refundOrder(order.id)).rejects.toMatchObject({ code: 'conflict' });

    t.moyasar.pay(order.id);
    await settleOrder(order.id);
    await expect(
      refundOrder(order.id, { amountHalalas: order.amountHalalas + 1 }),
    ).rejects.toMatchObject({
      code: 'bad_request',
    });
    await expect(refundOrder(order.id, { amountHalalas: 0 })).rejects.toMatchObject({
      code: 'bad_request',
    });
    await expect(refundOrder('ord_00000000000000000000000000')).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(t.balance(user.id)).toBe(500);
  });
});
