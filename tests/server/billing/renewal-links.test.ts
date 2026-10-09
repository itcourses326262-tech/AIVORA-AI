import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DAY_MS, RENEWAL_GRACE_MS, RENEWAL_LEAD_MS, addMonthsUtc } from '@/lib/billing/period';
import { createCheckout } from '@/server/billing/orders';
import { planStep, tick } from '@/server/billing/scheduler';
import { settleOrder } from '@/server/billing/settle';
import { cancelSubscription, currentSubscription } from '@/server/billing/subscriptions';
import { orders, subscriptions } from '@/server/db/schema';
import { billingTest } from './support';

const t = billingTest();
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
const END1 = addMonthsUtc(T0, 1, 8);
const END2 = addMonthsUtc(END1, 1, 8);

async function subscribe(userId: string) {
  const { order } = await createCheckout(
    userId,
    { type: 'subscription', id: 'pro' },
    { idempotencyKey: 'k', now: T0 },
  );
  t.moyasar.pay(order.id);
  await settleOrder(order.id, { now: T0 });
}

const renewals = (userId: string) =>
  t.db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.kind, 'subscription_renewal')))
    .orderBy(orders.createdAt, orders.id)
    .all();
const subOf = (userId: string) =>
  t.db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get();

describe('planStep while past due', () => {
  const pastDue = { status: 'past_due', cancelAtPeriodEnd: false, currentPeriodEnd: END1 } as const;

  it.each([
    ['link out, grace running', true, END1 + DAY_MS, 'wait'],
    ['no link (it was closed), grace running', false, END1 + DAY_MS, 'issue_renewal'],
    [
      'no link, last moment of the grace period',
      false,
      END1 + RENEWAL_GRACE_MS - 1,
      'issue_renewal',
    ],
    ['no link, grace over', false, END1 + RENEWAL_GRACE_MS, 'expire'],
    ['link out, grace over', true, END1 + RENEWAL_GRACE_MS, 'expire'],
  ] as const)('%s', (_name, hasPending, now, expected) => {
    expect(planStep(pastDue, hasPending, now)).toBe(expected);
  });

  it('a canceled subscription never gets a link', () => {
    expect(planStep({ ...pastDue, cancelAtPeriodEnd: true }, false, END1 + DAY_MS)).toBe(
      'finalize_cancel',
    );
  });
});

describe('a renewal link the gateway closed is replaced', () => {
  it('while past due: the owner cancels the invoice in the dashboard, the buyer gets a new link', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    await tick(END1 + 1000);
    expect(subOf(user.id)?.status).toBe('past_due');
    const [first] = renewals(user.id);
    expect(first?.status).toBe('pending');

    t.moyasar.invoiceOf(first?.id ?? '').status = 'canceled';
    await tick(END1 + 2 * DAY_MS);

    const [closed, replacement] = renewals(user.id);
    expect(closed).toMatchObject({ id: first?.id, status: 'failed' });
    expect(replacement).toMatchObject({ status: 'pending', subscriptionId: subOf(user.id)?.id });
    expect(replacement?.checkoutUrl).toMatch(/^https:\/\//);
    expect(replacement?.expiresAt).toBe(END1 + RENEWAL_GRACE_MS);
    expect(currentSubscription(user.id, END1 + 2 * DAY_MS)?.pendingOrder?.id).toBe(replacement?.id);
    expect(subOf(user.id)?.status).toBe('past_due');

    // Paying the new link keeps the subscription, counted from the end of the old month.
    t.moyasar.pay(replacement?.id ?? '');
    await settleOrder(replacement?.id ?? '', { now: END1 + 3 * DAY_MS });
    expect(subOf(user.id)).toMatchObject({
      status: 'active',
      currentPeriodStart: END1,
      currentPeriodEnd: END2,
    });
    expect(t.balance(user.id)).toBe(6000);
  });

  it('before the month ends: the new link comes at once, not at the end of the month', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    const [first] = renewals(user.id);

    t.moyasar.invoiceOf(first?.id ?? '').status = 'canceled';
    await tick(END1 - 2 * DAY_MS);

    const all = renewals(user.id);
    expect(all.map((order) => order.status)).toEqual(['failed', 'pending']);
    expect(subOf(user.id)?.status).toBe('active');
  });

  it('a link that closed because the subscription was canceled is not replaced', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    await cancelSubscription(user.id, END1 - 2 * DAY_MS);
    const invoicesBefore = t.moyasar.callsTo('POST', /^\/invoices$/).length;

    await tick(END1 - DAY_MS);
    await tick(END1 + DAY_MS);

    expect(t.moyasar.callsTo('POST', /^\/invoices$/)).toHaveLength(invoicesBefore);
    expect(subOf(user.id)?.status).toBe('canceled');
  });

  it('a gateway that keeps closing the link does not make the scheduler spin', async () => {
    const user = t.newUser();
    await subscribe(user.id);
    await tick(END1 - RENEWAL_LEAD_MS + 1000);
    await tick(END1 + 1000);

    for (let day = 1; day <= 3; day += 1) {
      const [open] = renewals(user.id).filter((order) => order.status === 'pending');
      t.moyasar.invoiceOf(open?.id ?? '').status = 'canceled';
      await tick(END1 + day * DAY_MS);
      // The same moment again: nothing more happens.
      await tick(END1 + day * DAY_MS + 1000);
    }

    expect(renewals(user.id).filter((order) => order.status === 'pending')).toHaveLength(1);
    expect(renewals(user.id)).toHaveLength(4);
  });
});
