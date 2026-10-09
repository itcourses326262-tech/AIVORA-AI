import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createCheckout } from '@/server/billing/orders';
import { settleOrder } from '@/server/billing/settle';
import { creditLedger } from '@/server/db/schema';
import { expectConsistentLedger } from '../../helpers/credits';
import type { FakeInvoice } from './fake-moyasar';
import { billingTest } from './support';

const t = billingTest();

type FakePaymentInput = FakeInvoice['payments'][number];

async function buy(userId: string, id = 'pack-500') {
  const { order } = await createCheckout(
    userId,
    { type: 'pack', id },
    { idempotencyKey: `k-${Math.random()}` },
  );
  return order;
}

/** Adds a payment object to the order's invoice the way Moyasar lists it (without touching the invoice status). */
function addPayment(
  orderId: string,
  status: FakePaymentInput['status'],
  over: Partial<FakePaymentInput> = {},
) {
  const invoice = t.moyasar.invoiceOf(orderId);
  const payment: FakePaymentInput = {
    id: randomUUID(),
    status,
    amount: invoice.amount,
    currency: invoice.currency,
    refunded: 0,
    ...over,
  };
  invoice.payments.push(payment);
  return payment;
}

const stateOf = async (orderId: string) =>
  t.gateway.fetchPayment({ invoiceId: t.moyasar.invoiceOf(orderId).id });

describe('a payment that took money wins over the invoice status', () => {
  it.each(['canceled', 'expired', 'voided'] as const)(
    'a paid payment on a %s invoice is credited, not failed',
    async (invoiceStatus) => {
      const user = t.newUser();
      const order = await buy(user.id);
      const payment = addPayment(order.id, 'paid');
      t.moyasar.invoiceOf(order.id).status = invoiceStatus;

      const result = await settleOrder(order.id);

      expect(result?.outcome).toBe('paid');
      expect(t.order(order.id)).toMatchObject({
        status: 'paid',
        gatewayPaymentId: payment.id,
      });
      expect(t.balance(user.id)).toBe(500);
      expect((await settleOrder(order.id))?.outcome).toBe('already_paid');
      expect(t.balance(user.id)).toBe(500);
    },
  );

  it('a failed order whose checkout was paid after we gave up on it is still credited', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.expire(order.id);
    expect((await settleOrder(order.id))?.order.status).toBe('failed');

    addPayment(order.id, 'captured');
    expect((await settleOrder(order.id))?.outcome).toBe('paid');
    expect(t.balance(user.id)).toBe(500);
  });

  it('a paid payment of another amount on a canceled invoice is parked for a person, never failed', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    addPayment(order.id, 'paid', { amount: 100 });
    t.moyasar.invoiceOf(order.id).status = 'canceled';

    const state = await stateOf(order.id);
    expect(state).toMatchObject({ status: 'paid', amountHalalas: 2900, paidAmountHalalas: 100 });

    expect((await settleOrder(order.id))?.outcome).toBe('needs_review');
    expect(t.order(order.id)).toMatchObject({ status: 'needs_review', paidAt: null });
    expect(t.balance(user.id)).toBe(0);
  });

  it('a payment in another currency than the invoice is parked, even when the invoice looks right', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    addPayment(order.id, 'paid', { currency: 'USD' });
    t.moyasar.invoiceOf(order.id).status = 'paid';

    expect(await stateOf(order.id)).toMatchObject({ currency: 'SAR', paidCurrency: 'USD' });
    expect((await settleOrder(order.id))?.outcome).toBe('needs_review');
    expect(t.balance(user.id)).toBe(0);
  });

  it('two payments on one invoice (a double charge) are parked, not credited once as if all were well', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    addPayment(order.id, 'paid');
    addPayment(order.id, 'paid');
    t.moyasar.invoiceOf(order.id).status = 'paid';

    expect(await stateOf(order.id)).toMatchObject({ status: 'paid', paidAmountHalalas: 5800 });
    expect((await settleOrder(order.id))?.outcome).toBe('needs_review');
    expect(t.balance(user.id)).toBe(0);
  });
});

describe('a voided payment is not money that went back', () => {
  it('a voided attempt next to the payment that went through changes nothing', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    addPayment(order.id, 'voided');
    const paid = addPayment(order.id, 'paid');
    t.moyasar.invoiceOf(order.id).status = 'paid';

    const state = await stateOf(order.id);
    expect(state).toMatchObject({ status: 'paid', paymentId: paid.id, refundedHalalas: 0 });
    expect((await settleOrder(order.id))?.outcome).toBe('paid');
    expect(t.order(order.id)).toMatchObject({ status: 'paid', refundedHalalas: 0 });
    expect(t.order(order.id).gatewayPaymentId).toBe(paid.id);
    expect(t.balance(user.id)).toBe(500);
  });

  it('a voided attempt on an invoice that can still be paid leaves the order pending', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    addPayment(order.id, 'voided');

    expect((await settleOrder(order.id))?.outcome).toBe('pending');
    expect(t.order(order.id).status).toBe('pending');

    // And the buyer paying afterwards is credited, not read as "refunded".
    addPayment(order.id, 'paid');
    t.moyasar.invoiceOf(order.id).status = 'paid';
    expect((await settleOrder(order.id))?.outcome).toBe('paid');
    expect(t.balance(user.id)).toBe(500);
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('a voided attempt on a canceled invoice is a closed checkout', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    addPayment(order.id, 'voided');
    t.moyasar.invoiceOf(order.id).status = 'canceled';

    expect((await settleOrder(order.id))?.outcome).toBe('closed');
    expect(t.order(order.id).status).toBe('failed');
  });

  it('a payment voided together with its invoice after it was paid is money returned', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);
    await settleOrder(order.id);
    expect(t.balance(user.id)).toBe(500);

    t.moyasar.refundOutside(order.id, undefined, 'voided');
    const result = await settleOrder(order.id);

    expect(result?.outcome).toBe('refunded');
    expect(t.balance(user.id)).toBe(0);
  });

  it('money returned from the paid payment counts while a voided attempt exists', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    addPayment(order.id, 'voided');
    t.moyasar.invoiceOf(order.id).status = 'initiated';
    const paid = addPayment(order.id, 'paid');
    t.moyasar.invoiceOf(order.id).status = 'paid';
    await settleOrder(order.id);
    expect(t.balance(user.id)).toBe(500);

    paid.status = 'refunded';
    paid.refunded = paid.amount;
    t.moyasar.invoiceOf(order.id).status = 'refunded';

    expect((await settleOrder(order.id))?.outcome).toBe('refunded');
    expect(t.balance(user.id)).toBe(0);
    expectConsistentLedger(t.db, user.id, 0);
    expect(
      t.db.select().from(creditLedger).where(eq(creditLedger.userId, user.id)).all(),
    ).toHaveLength(2);
  });
});
