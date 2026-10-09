import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runBillingAdminCli } from '@/server/billing/admin-cli';
import { createCheckout } from '@/server/billing/orders';
import { refundOrder } from '@/server/billing/refunds';
import { resolveReviewedOrder, resolvedStatus } from '@/server/billing/review';
import { tick } from '@/server/billing/scheduler';
import { settleOrder } from '@/server/billing/settle';
import { isUnpaid } from '@/server/billing/transitions';
import { creditLedger } from '@/server/db/schema';
import { debitCredits } from '@/server/credits';
import type { CliIo } from '@/server/auth/admin/io';
import { expectConsistentLedger } from '../../helpers/credits';
import { createGeneration } from '../../helpers/factories';
import { billingTest } from './support';

const t = billingTest();
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
const HOUR = 60 * 60 * 1000;

async function buy(userId: string, id = 'pack-500') {
  const { order } = await createCheckout(
    userId,
    { type: 'pack', id },
    { idempotencyKey: `k-${Math.random()}`, now: T0 },
  );
  return order;
}

function fakeIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readSecret: async () => '',
    env: () => undefined,
  };
  return { io, out, err };
}

const ledgerOf = (userId: string) =>
  t.db.select().from(creditLedger).where(eq(creditLedger.userId, userId)).all();

describe('an order parked for review is not a dead end', () => {
  it('is credited once the gateway shows a payment that matches in every respect', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    // The gateway failed to echo our reference once.
    t.moyasar.pay(order.id, { orderRef: null });
    expect((await settleOrder(order.id))?.outcome).toBe('needs_review');
    expect(t.balance(user.id)).toBe(0);

    t.moyasar.invoiceOf(order.id).metadata.order_id = order.id;
    const again = await settleOrder(order.id);

    expect(again?.outcome).toBe('paid');
    expect(t.order(order.id)).toMatchObject({ status: 'paid' });
    expect(t.order(order.id).paidAt).not.toBeNull();
    expect(t.balance(user.id)).toBe(500);
    // Exactly once, however often it is looked at afterwards.
    expect((await settleOrder(order.id))?.outcome).toBe('already_paid');
    expect(ledgerOf(user.id)).toHaveLength(1);
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('a mismatch that persists stays parked and is never credited', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id, { amount: 100 });

    for (let i = 0; i < 3; i += 1) {
      expect((await settleOrder(order.id))?.order.status).toBe('needs_review');
    }
    expect(t.balance(user.id)).toBe(0);
    expect(ledgerOf(user.id)).toEqual([]);
  });

  it('the scheduler keeps looking at a parked order and credits it when the gateway comes right', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id, { orderRef: null });
    await settleOrder(order.id, { now: T0 });
    expect(t.order(order.id).status).toBe('needs_review');

    t.moyasar.invoiceOf(order.id).metadata.order_id = order.id;
    const report = await tick(T0 + 7 * HOUR);

    expect(report.paidChecked).toBe(1);
    expect(t.order(order.id).status).toBe('paid');
    expect(t.balance(user.id)).toBe(500);
  });

  it('a mismatched payment that is then refunded in full is closed as refunded, with no credits', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id, { amount: 100 });
    await settleOrder(order.id);
    expect(t.order(order.id).status).toBe('needs_review');

    const result = await refundOrder(order.id);

    expect(result.order).toMatchObject({ status: 'refunded', refundedHalalas: 100, paidAt: null });
    expect(result.refundedNowHalalas).toBe(100);
    expect(t.balance(user.id)).toBe(0);
    expect(ledgerOf(user.id)).toEqual([]);
    // Nothing is left in the queue and nothing happens a second time.
    expect((await settleOrder(order.id))?.order.status).toBe('refunded');
  });

  it('a mismatched payment returned in the dashboard resolves itself the next time it is looked at', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id, { orderRef: 'ord_00000000000000000000000000' });
    await settleOrder(order.id);
    expect(t.order(order.id).status).toBe('needs_review');

    t.moyasar.refundOutside(order.id);
    const result = await settleOrder(order.id);

    expect(result?.outcome).toBe('refunded');
    expect(t.order(order.id)).toMatchObject({ status: 'refunded', refundedHalalas: 2900 });
    expect(t.balance(user.id)).toBe(0);
  });

  it('an unpaid checkout whose wrong-amount payment was already returned never goes to review', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id, { amount: 100 });
    t.moyasar.refundOutside(order.id);

    expect((await settleOrder(order.id))?.outcome).toBe('refunded');
    expect(t.order(order.id).status).toBe('refunded');
  });

  it('an order that WAS credited and then could not be clawed back is never credited again', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);
    await settleOrder(order.id, { now: T0 });
    const generation = createGeneration(t.db, { userId: user.id });
    debitCredits(t.db, { userId: user.id, amount: 450, generationId: generation.id });
    // Half of the money goes back; only 50 of the 250 credits to take back are still there.
    await refundOrder(order.id, { amountHalalas: 1450, now: T0 });
    const parked = t.order(order.id);
    expect(parked).toMatchObject({
      status: 'needs_review',
      refundedHalalas: 1450,
      clawedBackCredits: 50,
    });
    expect(parked.paidAt).not.toBeNull();
    expect(isUnpaid(parked)).toBe(false);

    const before = ledgerOf(user.id).length;
    expect((await settleOrder(order.id, { now: T0 }))?.outcome).toBe('already_paid');
    await tick(T0 + 10 * HOUR);
    expect(t.order(order.id).status).toBe('needs_review');
    expect(ledgerOf(user.id)).toHaveLength(before);
    expect(t.balance(user.id)).toBe(0);
  });
});

describe('isUnpaid and resolvedStatus', () => {
  it('an order is unpaid until its credits were granted', () => {
    expect(isUnpaid({ status: 'pending', paidAt: null })).toBe(true);
    expect(isUnpaid({ status: 'failed', paidAt: null })).toBe(true);
    expect(isUnpaid({ status: 'canceled', paidAt: null })).toBe(true);
    expect(isUnpaid({ status: 'needs_review', paidAt: null })).toBe(true);
    expect(isUnpaid({ status: 'needs_review', paidAt: 5 })).toBe(false);
    expect(isUnpaid({ status: 'paid', paidAt: 5 })).toBe(false);
    expect(isUnpaid({ status: 'refunded', paidAt: null })).toBe(false);
  });

  it('a reviewed order ends refunded, paid or canceled', () => {
    expect(resolvedStatus({ refundedHalalas: 2900, amountHalalas: 2900, paidAt: 5 })).toBe(
      'refunded',
    );
    expect(resolvedStatus({ refundedHalalas: 100, amountHalalas: 2900, paidAt: 5 })).toBe('paid');
    expect(resolvedStatus({ refundedHalalas: 0, amountHalalas: 2900, paidAt: null })).toBe(
      'canceled',
    );
  });
});

describe('resolve-order closes the queue by hand', () => {
  it('closes a shortfall order as refunded and a parked mismatch as canceled, moving nothing', async () => {
    const shortfall = t.newUser();
    const spent = await buy(shortfall.id);
    t.moyasar.pay(spent.id);
    await settleOrder(spent.id);
    const generation = createGeneration(t.db, { userId: shortfall.id });
    debitCredits(t.db, { userId: shortfall.id, amount: 500, generationId: generation.id });
    await refundOrder(spent.id);
    expect(t.order(spent.id).status).toBe('needs_review');

    const other = t.newUser();
    const parked = await buy(other.id);
    t.moyasar.pay(parked.id, { amount: 100 });
    await settleOrder(parked.id);

    const balances = [t.balance(shortfall.id), t.balance(other.id)];
    const ledgers = [ledgerOf(shortfall.id).length, ledgerOf(other.id).length];
    expect(resolveReviewedOrder(spent.id, 'user spent the credits; loss accepted').status).toBe(
      'refunded',
    );
    expect(resolveReviewedOrder(parked.id, 'wrong amount, handled by support').status).toBe(
      'canceled',
    );

    expect([t.balance(shortfall.id), t.balance(other.id)]).toEqual(balances);
    expect([ledgerOf(shortfall.id).length, ledgerOf(other.id).length]).toEqual(ledgers);
  });

  it('only an order in needs_review can be resolved, and a note is required', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    expect(() => resolveReviewedOrder(order.id, 'because')).toThrow(/not needs_review/);
    expect(() => resolveReviewedOrder(order.id, '  ')).toThrow(/note/);
    expect(() => resolveReviewedOrder('ord_00000000000000000000000000', 'because')).toThrow(
      /No order/,
    );
    expect(t.order(order.id).status).toBe('pending');
  });

  it('is a CLI command with the usual exit codes', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id, { amount: 100 });
    await settleOrder(order.id);

    const noNote = fakeIo();
    expect(await runBillingAdminCli(['resolve-order', order.id], noNote.io)).toBe(2);
    expect(noNote.err.join('\n')).toContain('--note');
    expect(t.order(order.id).status).toBe('needs_review');

    const done = fakeIo();
    expect(
      await runBillingAdminCli(['resolve-order', order.id, '--note', 'refunded by hand'], done.io),
    ).toBe(0);
    expect(done.out.join('\n')).toContain('closed as canceled');
    expect(t.order(order.id).status).toBe('canceled');

    const again = fakeIo();
    expect(
      await runBillingAdminCli(['resolve-order', order.id, '--note', 'refunded by hand'], again.io),
    ).toBe(1);
  });
});
