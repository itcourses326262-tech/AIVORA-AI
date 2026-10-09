import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { deleteAccount } from '@/server/auth/account-deletion';
import { listAccountDeletedHooks, onAccountDeleted } from '@/server/auth/account-hooks';
import { BILLING_ACCOUNT_HOOK, endBillingForAccount } from '@/server/billing/account';
import { setGatewayOverride } from '@/server/billing/config';
import { bootBillingScheduler } from '@/server/billing/boot';
import { createCheckout } from '@/server/billing/orders';
import { tick } from '@/server/billing/scheduler';
import { settleOrder } from '@/server/billing/settle';
import { stopBillingScheduler } from '@/server/billing/scheduler';
import { orders, subscriptions, users } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { createLogger } from '@/server/logger';
import { setStorageOverride } from '@/server/storage';
import { DAY_MS, RENEWAL_LEAD_MS, addMonthsUtc } from '@/lib/billing/period';
import { fakeStorage } from '../../helpers/factories';
import { cleanEmailState } from '../email/support';
import { billingTest } from './support';

const t = billingTest();
cleanEmailState();

const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
const END1 = addMonthsUtc(T0, 1, 8);
const unregister: Array<() => void> = [];

beforeEach(() => {
  setStorageOverride(fakeStorage());
  // What instrumentation does at start-up (the hook is only registered by start-up code).
  bootBillingScheduler(createLogger({ level: 'silent' }));
});
afterEach(async () => {
  setStorageOverride(null);
  while (unregister.length) unregister.pop()?.();
  await stopBillingScheduler();
});

async function subscribe(userId: string, plan = 'pro') {
  const { order } = await createCheckout(
    userId,
    { type: 'subscription', id: plan },
    { idempotencyKey: `sub-${plan}`, now: T0 },
  );
  t.moyasar.pay(order.id);
  await settleOrder(order.id, { now: T0 });
  return order;
}

async function openPack(userId: string, key = `pack-${Math.random()}`) {
  const { order } = await createCheckout(
    userId,
    { type: 'pack', id: 'pack-500' },
    { idempotencyKey: key, now: T0 },
  );
  return order;
}

const subscriptionOf = (userId: string) =>
  t.db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get();
const pendingOf = (userId: string) =>
  t.db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.status, 'pending')))
    .all();

describe('start-up registers the billing hook', () => {
  it('as soon as billing boots, whatever the job runner is doing', () => {
    expect(listAccountDeletedHooks()).toContain(BILLING_ACCOUNT_HOOK);
  });
});

describe('deleting an account ends what billing holds for it', () => {
  it('ends the subscription and withdraws every open payment page', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    const pack = await openPack(user.id);
    expect(subscriptionOf(user.id)?.status).toBe('active');

    const result = await deleteAccount(user.id);

    expect(result.alreadyDeleted).toBe(false);
    expect(subscriptionOf(user.id)).toMatchObject({
      status: 'canceled',
      cancelAtPeriodEnd: true,
      nextChargeAt: null,
    });
    expect(t.order(pack.id).status).toBe('canceled');
    expect(pendingOf(user.id)).toEqual([]);
    // The page really is closed at the gateway: nobody can pay it any more.
    expect(t.moyasar.invoiceOf(pack.id).status).toBe('canceled');
    expect(t.db.select().from(users).where(eq(users.id, user.id)).get()?.deletedAt).not.toBeNull();
  });

  it('no renewal link is ever issued for a deleted account', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await deleteAccount(user.id);
    const invoicesBefore = t.moyasar.callsTo('POST', /^\/invoices$/).length;

    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    await tick(END1 + DAY_MS);

    expect(t.moyasar.callsTo('POST', /^\/invoices$/)).toHaveLength(invoicesBefore);
    expect(t.db.select().from(orders).where(eq(orders.kind, 'subscription_renewal')).all()).toEqual(
      [],
    );
  });

  it('an unpaid first month is abandoned along with its subscription', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'subscription', id: 'starter' },
      { idempotencyKey: 'first', now: T0 },
    );

    await deleteAccount(user.id);

    expect(t.order(order.id).status).toBe('canceled');
    expect(subscriptionOf(user.id)?.status).toBe('canceled');
    expect(t.moyasar.invoiceOf(order.id).status).toBe('canceled');
  });

  it('a payment made just before the deletion is credited first, then its subscription ends', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'racing', now: T0 },
    );
    t.moyasar.pay(order.id); // paid, but nobody has told us yet

    await deleteAccount(user.id);

    expect(t.order(order.id).status).toBe('paid');
    expect(subscriptionOf(user.id)?.status).toBe('canceled');
  });

  it('is idempotent', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await openPack(user.id);

    expect(await endBillingForAccount(user.id, T0)).toEqual({
      checkoutsWithdrawn: 1,
      subscriptionEnded: true,
    });
    expect(await endBillingForAccount(user.id, T0)).toEqual({
      checkoutsWithdrawn: 0,
      subscriptionEnded: false,
    });
  });

  it('an account with nothing to end deletes as before', async () => {
    const user = t.newUser();
    const result = await deleteAccount(user.id);
    expect(result.alreadyDeleted).toBe(false);
  });
});

describe('when the payment page cannot be withdrawn the deletion stops, and can be repeated', () => {
  it('a gateway outage vetoes the deletion and leaves the account and its subscription alone', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    const pack = await openPack(user.id);

    t.moyasar.failNext(2, 503);
    await expect(deleteAccount(user.id)).rejects.toMatchObject({ code: 'provider_error' });

    const row = t.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row?.deletedAt).toBeNull();
    expect(subscriptionOf(user.id)?.status).toBe('active');
    expect(t.order(pack.id).status).toBe('pending');

    // The user tries again once the gateway is back.
    const result = await deleteAccount(user.id);
    expect(result.alreadyDeleted).toBe(false);
    expect(t.order(pack.id).status).toBe('canceled');
    expect(subscriptionOf(user.id)?.status).toBe('canceled');
  });

  it('a page made with another gateway than this process uses is not skipped silently', async () => {
    const user = t.newUser();
    const pack = await openPack(user.id);
    t.db.update(orders).set({ gateway: 'mock' }).where(eq(orders.id, pack.id)).run();

    await expect(endBillingForAccount(user.id)).rejects.toMatchObject({
      code: 'provider_error',
      message: expect.stringContaining('NODE_ENV=production'),
    });
    expect(t.order(pack.id).status).toBe('pending');
  });

  it('with billing switched off the pages are closed locally and the deletion goes through', async () => {
    const user = t.newUser();
    const pack = await openPack(user.id);
    setGatewayOverride(null);
    process.env.BILLING_GATEWAY = 'off';
    resetEnvForTests();
    try {
      await deleteAccount(user.id);
    } finally {
      delete process.env.BILLING_GATEWAY;
      resetEnvForTests();
    }
    expect(t.order(pack.id).status).toBe('canceled');
  });
});

describe('money that arrives for a deleted account is never credited', () => {
  it('a canceled page paid anyway is parked for a person to refund', async () => {
    const user = t.newUser();
    const pack = await openPack(user.id);
    await deleteAccount(user.id);
    expect(t.order(pack.id).status).toBe('canceled');

    // The buyer was already in 3-D Secure when the page was withdrawn.
    const invoice = t.moyasar.invoiceOf(pack.id);
    invoice.payments.push({
      id: 'late-payment',
      status: 'paid',
      amount: invoice.amount,
      currency: invoice.currency,
      refunded: 0,
    });
    const result = await settleOrder(pack.id);

    expect(result?.outcome).toBe('needs_review');
    expect(t.order(pack.id)).toMatchObject({ status: 'needs_review', paidAt: null });
    expect(t.balance(user.id)).toBe(0);
  });

  it('a subscription of an account deleted before billing knew is ended instead of renewed', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    // Deleted while no billing hook was registered (older deployments).
    unregister.push(onAccountDeleted(BILLING_ACCOUNT_HOOK, () => undefined));
    await deleteAccount(user.id);
    expect(subscriptionOf(user.id)?.status).toBe('active');

    await tick(END1 - RENEWAL_LEAD_MS + 1000);

    expect(subscriptionOf(user.id)).toMatchObject({ status: 'canceled', nextChargeAt: null });
    expect(t.db.select().from(orders).where(eq(orders.kind, 'subscription_renewal')).all()).toEqual(
      [],
    );
  });
});
