import { describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import { DAY_MS } from '@/lib/billing/period';
import { debitCredits } from '@/server/credits';
import { createCheckout } from '@/server/billing/orders';
import { refundOrder } from '@/server/billing/refunds';
import { tick } from '@/server/billing/scheduler';
import { settleOrder } from '@/server/billing/settle';
import { cancelSubscription, resumeSubscription } from '@/server/billing/subscriptions';
import { handleWebhook } from '@/server/billing/webhooks';
import { creditLedger, orders, subscriptions, type OrderRow } from '@/server/db/schema';
import { expectConsistentLedger } from '../../helpers/credits';
import { createGeneration } from '../../helpers/factories';
import { billingTest } from './support';

const t = billingTest();

/** Small deterministic PRNG so a failing run can be replayed from its seed. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const ITEMS = [
  { type: 'pack', id: 'pack-500' },
  { type: 'pack', id: 'pack-1500' },
  { type: 'pack', id: 'pack-5000' },
  { type: 'subscription', id: 'starter' },
  { type: 'subscription', id: 'pro' },
] as const;

interface World {
  userIds: string[];
  /** Credits the test itself spent on generations, per user. */
  spent: Map<string, number>;
  now: number;
  rng: () => number;
}

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)] as T;

/** Anything the services refuse on purpose is fine; a crash or an invariant break is not. */
async function attempt(work: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!isAppError(error)) throw error;
  }
}

async function step(world: World): Promise<void> {
  const { rng } = world;
  const userId = pick(rng, world.userIds);
  const all = t.db.select().from(orders).all();
  const mine = all.filter((order) => order.userId === userId);
  const anyOrder = (): OrderRow | undefined => (all.length ? pick(rng, all) : undefined);
  const gatewayHas = (order: OrderRow | undefined) =>
    order !== undefined &&
    [...t.moyasar.invoices.values()].some((invoice) => invoice.metadata.order_id === order.id);

  switch (Math.floor(rng() * 16)) {
    case 0:
    case 1:
    case 2: {
      const item = pick(rng, ITEMS);
      // Half of the keys repeat, so replays and conflicts happen too.
      await attempt(() =>
        createCheckout(userId, item, {
          idempotencyKey: `key-${Math.floor(rng() * 6)}`,
          now: world.now,
        }),
      );
      break;
    }
    case 3:
    case 4: {
      const order = anyOrder();
      if (gatewayHas(order) && t.moyasar.invoiceOf(order?.id ?? '').status === 'initiated') {
        t.moyasar.pay(order?.id ?? '');
      }
      break;
    }
    case 5: {
      const order = anyOrder();
      if (gatewayHas(order) && t.moyasar.invoiceOf(order?.id ?? '').status !== 'paid') {
        if (rng() < 0.5) t.moyasar.expire(order?.id ?? '');
        else t.moyasar.declineAttempt(order?.id ?? '');
      }
      break;
    }
    case 6: {
      const order = anyOrder();
      if (gatewayHas(order)) {
        const invoice = t.moyasar.invoiceOf(order?.id ?? '');
        const paid = invoice.payments.find((payment) => payment.status === 'paid');
        if (paid && paid.refunded < paid.amount) {
          const left = paid.amount - paid.refunded;
          t.moyasar.refundOutside(
            order?.id ?? '',
            rng() < 0.5 ? undefined : Math.max(1, Math.floor(left * rng())),
            rng() < 0.2 ? 'voided' : 'refunded',
          );
        }
      }
      break;
    }
    case 7:
    case 8: {
      const order = anyOrder();
      if (order) {
        const copies = 1 + Math.floor(rng() * 3);
        await Promise.all(
          Array.from({ length: copies }, () =>
            attempt(() => settleOrder(order.id, { now: world.now })),
          ),
        );
      }
      break;
    }
    case 9: {
      const order = anyOrder();
      if (gatewayHas(order)) {
        const delivery = t.moyasar.webhook(
          pick(rng, ['payment_paid', 'payment_refunded', 'payment_failed']),
          order?.id ?? '',
          {
            eventId: `evt-${Math.floor(rng() * 8)}`,
          },
        );
        await attempt(() => handleWebhook(delivery, world.now));
      }
      break;
    }
    case 10: {
      const generation = createGeneration(t.db, { userId });
      const balance = t.balance(userId);
      const amount = Math.min(balance, 1 + Math.floor(rng() * 800));
      if (amount > 0) {
        debitCredits(t.db, { userId, amount, generationId: generation.id });
        world.spent.set(userId, (world.spent.get(userId) ?? 0) + amount);
      }
      break;
    }
    case 11:
    case 14: {
      // Mostly small steps (a poll, a retry), sometimes weeks, so every stage of a month is visited.
      world.now += Math.floor(rng() * (rng() < 0.6 ? DAY_MS : 12 * DAY_MS));
      await tick(world.now);
      break;
    }
    case 12: {
      await attempt(() =>
        rng() < 0.6 ? cancelSubscription(userId, world.now) : resumeSubscription(userId, world.now),
      );
      break;
    }
    default: {
      const order = mine.find(
        (candidate) => candidate.status === 'paid' || candidate.status === 'needs_review',
      );
      if (order) {
        const left = order.amountHalalas - order.refundedHalalas;
        await attempt(() =>
          refundOrder(order.id, {
            amountHalalas: rng() < 0.5 ? undefined : Math.max(1, Math.floor(left * rng())),
            now: world.now,
          }),
        );
      }
      if (rng() < 0.15) t.moyasar.failNext(1 + Math.floor(rng() * 2), rng() < 0.5 ? 503 : 0);
    }
  }
}

function snapshot() {
  return JSON.stringify(
    t.db
      .select()
      .from(orders)
      .all()
      .map((order) => ({
        ...order,
        lastCheckedAt: null,
        updatedAt: null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

function checkInvariants(world: World, label: string): void {
  const rows = t.db.select().from(orders).all();
  const ledger = t.db.select().from(creditLedger).all();

  for (const userId of world.userIds) {
    // The balance is the sum of the ledger, never below zero, with an unbroken chain.
    expectConsistentLedger(t.db, userId, 0);

    const mine = rows.filter((order) => order.userId === userId);
    const granted = mine.reduce(
      (sum, order) => sum + (order.paidAt === null ? 0 : order.credits),
      0,
    );
    const clawed = mine.reduce((sum, order) => sum + order.clawedBackCredits, 0);
    // Conservation: everything bought, minus everything taken back, minus everything spent.
    expect(t.balance(userId), `${label}: balance of ${userId}`).toBe(
      granted - clawed - (world.spent.get(userId) ?? 0),
    );
  }

  for (const order of rows) {
    const keyed = (prefix: string) =>
      ledger.filter((entry) => entry.idempotencyKey?.startsWith(prefix));
    const grants = keyed(`order:${order.id}`);
    expect(grants.length, `${label}: grants of ${order.id}`).toBe(order.paidAt === null ? 0 : 1);
    if (grants[0]) expect(grants[0].delta).toBe(order.credits);

    const taken = keyed(`clawback:${order.id}:`).reduce((sum, entry) => sum - entry.delta, 0);
    expect(taken, `${label}: clawback ledger of ${order.id}`).toBe(order.clawedBackCredits);
    expect(order.clawedBackCredits).toBeLessThanOrEqual(order.credits);
    expect(order.refundedHalalas).toBeLessThanOrEqual(order.amountHalalas);
    if (order.paidAt === null) expect(order.clawedBackCredits).toBe(0);

    // No credit without money: whatever was granted, the gateway has a payment for it.
    if (order.paidAt !== null) {
      const invoice = [...t.moyasar.invoices.values()].find(
        (candidate) => candidate.metadata.order_id === order.id,
      );
      expect(invoice?.payments.length, `${label}: payment behind ${order.id}`).toBeGreaterThan(0);
      expect(invoice?.amount).toBe(order.amountHalalas);
    }
    // A fully refunded order that took everything back is "refunded"; one that could not is flagged.
    if (order.status === 'refunded') {
      expect(order.refundedHalalas).toBe(order.amountHalalas);
      if (order.paidAt !== null) expect(order.clawedBackCredits).toBe(order.credits);
    }
    if (order.status === 'paid') expect(order.refundedHalalas).toBeLessThan(order.amountHalalas);
    if (order.status === 'pending') expect(order.paidAt).toBeNull();
  }

  // One live subscription per user, whatever happened; running ones always have a period.
  const subs = t.db.select().from(subscriptions).all();
  for (const userId of world.userIds) {
    const live = subs.filter(
      (sub) => sub.userId === userId && ['incomplete', 'active', 'past_due'].includes(sub.status),
    );
    expect(live.length, `${label}: live subscriptions of ${userId}`).toBeLessThanOrEqual(1);
  }
  for (const sub of subs) {
    reached.subscriptionStatuses.add(sub.status);
    if (sub.status === 'active' || sub.status === 'past_due') {
      expect(sub.currentPeriodEnd).not.toBeNull();
    }
  }
}

/** What the random runs actually reached, so a generator that stops producing events fails loudly. */
const reached = {
  paid: 0,
  refunded: 0,
  partlyRefunded: 0,
  needsReview: 0,
  failed: 0,
  canceled: 0,
  clawbacks: 0,
  subscriptionStatuses: new Set<string>(),
};

function record(): void {
  for (const order of t.db.select().from(orders).all()) {
    if (order.paidAt !== null) reached.paid += 1;
    if (order.status === 'refunded') reached.refunded += 1;
    if (order.status === 'paid' && order.refundedHalalas > 0) reached.partlyRefunded += 1;
    if (order.status === 'needs_review') reached.needsReview += 1;
    if (order.status === 'failed') reached.failed += 1;
    if (order.status === 'canceled') reached.canceled += 1;
    if (order.clawedBackCredits > 0) reached.clawbacks += 1;
  }
  for (const sub of t.db.select().from(subscriptions).all())
    reached.subscriptionStatuses.add(sub.status);
}

describe('ledger conservation over random sequences of events', () => {
  const SEEDS = 40;
  const STEPS = 70;

  it.each(Array.from({ length: SEEDS }, (_, seed) => seed + 1))('seed %i', async (seed) => {
    const world: World = {
      userIds: [t.newUser().id, t.newUser().id],
      spent: new Map(),
      now: Date.UTC(2026, 9, 8, 10, 0, 0),
      rng: mulberry32(seed),
    };

    for (let i = 0; i < STEPS; i += 1) {
      await step(world);
      checkInvariants(world, `seed ${seed} step ${i}`);
    }

    // Quiet the gateway, look at every order once more: the books must settle to a fixed point.
    t.moyasar.failNext(0);
    for (const order of t.db.select().from(orders).all()) {
      await attempt(() => settleOrder(order.id, { now: world.now }));
    }
    checkInvariants(world, `seed ${seed} after reconciliation`);
    const settled = snapshot();
    const balances = world.userIds.map((id) => t.balance(id));
    for (const order of t.db.select().from(orders).all()) {
      await attempt(() => settleOrder(order.id, { now: world.now }));
      await attempt(() => settleOrder(order.id, { now: world.now }));
    }
    expect(snapshot(), `seed ${seed}: replaying every settlement changes nothing`).toBe(settled);
    expect(world.userIds.map((id) => t.balance(id))).toEqual(balances);
    record();
  });

  it('reached the interesting states (the generator is not vacuous)', () => {
    expect(reached.paid).toBeGreaterThan(40);
    expect(reached.refunded).toBeGreaterThan(5);
    expect(reached.partlyRefunded).toBeGreaterThan(3);
    expect(reached.needsReview).toBeGreaterThan(0);
    expect(reached.failed).toBeGreaterThan(5);
    expect(reached.canceled).toBeGreaterThan(0);
    expect(reached.clawbacks).toBeGreaterThan(5);
    expect([...reached.subscriptionStatuses].sort()).toEqual(
      expect.arrayContaining(['active', 'canceled', 'expired', 'past_due']),
    );
  });
});
