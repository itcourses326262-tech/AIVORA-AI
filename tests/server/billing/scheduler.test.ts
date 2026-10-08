import { describe, expect, it } from 'vitest';
import { DAY_MS, RENEWAL_GRACE_MS, RENEWAL_LEAD_MS } from '@/lib/billing/period';
import { createCheckout } from '@/server/billing/orders';
import { nextWakeup, planStep, pollIntervalMs, tick } from '@/server/billing/scheduler';
import { billingTest } from './support';

const t = billingTest();
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
const END = T0 + 30 * DAY_MS;

describe('planStep', () => {
  const active = { status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: END } as const;

  it.each([
    ['long before the month ends', active, false, END - RENEWAL_LEAD_MS - 1, 'wait'],
    ['at the start of the lead window', active, false, END - RENEWAL_LEAD_MS, 'issue_renewal'],
    ['inside the lead window with a link already out', active, true, END - DAY_MS, 'wait'],
    ['inside the lead window without one', active, false, END - DAY_MS, 'issue_renewal'],
    ['at the end of the month, link unpaid', active, true, END, 'mark_past_due'],
    ['at the end of the month, no link yet', active, false, END, 'issue_renewal'],
    [
      'past due, in the grace period',
      { ...active, status: 'past_due' },
      true,
      END + RENEWAL_GRACE_MS - 1,
      'wait',
    ],
    [
      'past due, grace over',
      { ...active, status: 'past_due' },
      true,
      END + RENEWAL_GRACE_MS,
      'expire',
    ],
    [
      'canceled, month still running',
      { ...active, cancelAtPeriodEnd: true },
      false,
      END - 1,
      'wait',
    ],
    ['canceled, month over', { ...active, cancelAtPeriodEnd: true }, false, END, 'finalize_cancel'],
    [
      'canceled while past due',
      { ...active, status: 'past_due', cancelAtPeriodEnd: true },
      false,
      END + 1,
      'finalize_cancel',
    ],
    ['no period at all', { ...active, currentPeriodEnd: null }, false, END, 'wait'],
  ] as const)('%s', (_name, subscription, pending, now, expected) => {
    expect(planStep(subscription, pending, now)).toBe(expected);
  });
});

describe('nextWakeup', () => {
  it('points at the next thing that has to happen', () => {
    const base = { currentPeriodEnd: END, cancelAtPeriodEnd: false } as const;
    expect(nextWakeup({ ...base, status: 'active' }, false)).toBe(END - RENEWAL_LEAD_MS);
    expect(nextWakeup({ ...base, status: 'active' }, true)).toBe(END);
    expect(nextWakeup({ ...base, status: 'past_due' }, true)).toBe(END + RENEWAL_GRACE_MS);
    expect(nextWakeup({ ...base, status: 'active', cancelAtPeriodEnd: true }, false)).toBe(END);
    expect(nextWakeup({ ...base, status: 'canceled' }, false)).toBeNull();
    expect(nextWakeup({ ...base, status: 'expired' }, false)).toBeNull();
  });
});

describe('pollIntervalMs', () => {
  it('checks young checkouts eagerly and old ones rarely', () => {
    expect(pollIntervalMs(60_000)).toBe(20_000);
    expect(pollIntervalMs(30 * 60_000)).toBe(5 * 60_000);
    expect(pollIntervalMs(5 * 60 * 60_000)).toBe(30 * 60_000);
  });
});

describe('reconciliation (the safety net for a missed webhook)', () => {
  it('credits a payment no webhook ever announced', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k', now: T0 },
    );
    t.moyasar.pay(order.id);

    const report = await tick(T0 + 25_000);

    expect(report.checkoutsChecked).toBe(1);
    expect(t.order(order.id).status).toBe('paid');
    expect(t.balance(user.id)).toBe(500);
  });

  it('does not ask the gateway about the same checkout more often than it needs to', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k', now: T0 },
    );

    await tick(T0 + 1000);
    await tick(T0 + 5000);
    await tick(T0 + 10_000);
    expect(t.moyasar.callsTo('GET', /^\/invoices\//)).toHaveLength(1);

    await tick(T0 + 25_000);
    expect(t.moyasar.callsTo('GET', /^\/invoices\//)).toHaveLength(2);
    expect(t.order(order.id).status).toBe('pending');
  });

  it('closes a checkout that is still payable long after its page expired', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k', now: T0 },
    );

    await tick(T0 + DAY_MS + 2 * 60 * 60 * 1000);

    expect(t.order(order.id).status).toBe('failed');
    expect(t.moyasar.callsTo('PUT', /\/cancel$/)).toHaveLength(1);
  });

  it('a gateway outage costs nothing but a retry', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k', now: T0 },
    );
    t.moyasar.pay(order.id);

    t.moyasar.failNext(1, 503);
    const down = await tick(T0 + 25_000);
    expect(down.errors).toBeGreaterThan(0);
    expect(t.balance(user.id)).toBe(0);

    await tick(T0 + 50_000);
    expect(t.balance(user.id)).toBe(500);
  });

  it('does nothing, and says so, when billing is switched off', async () => {
    const { setGatewayOverride } = await import('@/server/billing/config');
    setGatewayOverride(null);
    process.env.BILLING_GATEWAY = 'off';
    const { resetEnvForTests } = await import('@/server/env');
    resetEnvForTests();
    try {
      expect((await tick(T0)).active).toBe(false);
    } finally {
      delete process.env.BILLING_GATEWAY;
      resetEnvForTests();
    }
  });
});
