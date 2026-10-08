import 'server-only';
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import { RENEWAL_GRACE_MS, RENEWAL_LEAD_MS } from '@/lib/billing/period';
import { getPlan, splitVat } from '@/lib/billing/plans';
import { newId } from '@/lib/id';
import { getDb, withTx, type Db } from '@/server/db';
import { orders, subscriptions, users, type SubscriptionRow } from '@/server/db/schema';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';
import { getGateway } from './config';
import { ORPHAN_AFTER_MS, attachCheckout, isUniqueViolation } from './orders';
import { closeCheckout, settleOrder } from './settle';
import { pendingOrderOf } from './subscriptions';
import { closeOrder } from './transitions';

/**
 * Background work of billing. `tick(now)` is safe to run from any number of processes at once:
 * every unit of work is first CLAIMED with a compare-and-set (a lease written into the row), and
 * every state change it makes is itself a compare-and-set, so two ticks never do the same thing
 * twice and a crashed tick is picked up again when its lease runs out.
 *
 * What it does, in this order:
 *  1. closes checkouts that were never given a payment page (crash leftovers);
 *  2. re-asks the gateway about unpaid checkouts (the safety net for a missed webhook), closing
 *     the ones that stayed unpaid long after their page expired;
 *  3. withdraws renewal links whose subscription has ended;
 *  4. walks the subscriptions that are due: issue the renewal link, mark it past due, expire it,
 *     or finish a cancellation. See {@link planStep}.
 */

const log = () => getLogger().child({ module: 'billing-scheduler' });

export const TICK_INTERVAL_MS = 30_000;
export const BATCH_SIZE = 25;
/**
 * How long a claimed subscription is reserved for the claimant before another process may retry.
 * It is also the pause between attempts while the gateway keeps failing, so a long outage costs a
 * handful of rows an hour, not one every tick.
 */
export const LEASE_MS = 15 * 60 * 1000;
/** A page this long past its expiry that the gateway still calls payable is closed by force. */
export const EXPIRY_SLACK_MS = 60 * 60 * 1000;

/** How often an unpaid checkout is re-checked: eagerly while the buyer is probably paying. */
export function pollIntervalMs(ageMs: number): number {
  if (ageMs < 10 * 60 * 1000) return 20_000;
  if (ageMs < 2 * 60 * 60 * 1000) return 5 * 60 * 1000;
  return 30 * 60 * 1000;
}

export type SubscriptionStep =
  'issue_renewal' | 'mark_past_due' | 'expire' | 'finalize_cancel' | 'wait';

/**
 * The renewal timeline of one month ending at `E`:
 *   E - 3 days   the renewal link is issued (`issue_renewal`)
 *   E            still unpaid: `past_due` (`mark_past_due`), the link stays payable
 *   E + 7 days   still unpaid: `expired` (`expire`), the link is withdrawn
 * A subscription that was canceled never gets a link and ends at `E` (`finalize_cancel`). Paying at
 * any point before the end of the grace period moves the subscription to the next month. The
 * function is pure; the scheduler only executes what it says.
 */
export function planStep(
  subscription: Pick<SubscriptionRow, 'status' | 'cancelAtPeriodEnd' | 'currentPeriodEnd'>,
  hasPendingRenewal: boolean,
  now: number,
): SubscriptionStep {
  const end = subscription.currentPeriodEnd;
  if (end === null) return 'wait';
  if (subscription.cancelAtPeriodEnd) return now >= end ? 'finalize_cancel' : 'wait';
  if (subscription.status === 'past_due') return now >= end + RENEWAL_GRACE_MS ? 'expire' : 'wait';
  if (now >= end) return hasPendingRenewal ? 'mark_past_due' : 'issue_renewal';
  if (now >= end - RENEWAL_LEAD_MS) return hasPendingRenewal ? 'wait' : 'issue_renewal';
  return 'wait';
}

/** When a subscription needs the scheduler next. */
export function nextWakeup(
  subscription: Pick<SubscriptionRow, 'status' | 'cancelAtPeriodEnd' | 'currentPeriodEnd'>,
  hasPendingRenewal: boolean,
): number | null {
  const end = subscription.currentPeriodEnd;
  if (end === null || (subscription.status !== 'active' && subscription.status !== 'past_due')) {
    return null;
  }
  if (subscription.cancelAtPeriodEnd) return end;
  if (subscription.status === 'past_due') return end + RENEWAL_GRACE_MS;
  return hasPendingRenewal ? end : end - RENEWAL_LEAD_MS;
}

export interface TickReport {
  /** False when billing is switched off or misconfigured: nothing was done. */
  active: boolean;
  orphansClosed: number;
  checkoutsChecked: number;
  subscriptionsAdvanced: number;
  errors: number;
}

export async function tick(now: number = Date.now()): Promise<TickReport> {
  const report: TickReport = {
    active: true,
    orphansClosed: 0,
    checkoutsChecked: 0,
    subscriptionsAdvanced: 0,
    errors: 0,
  };
  let gatewayId: string;
  try {
    gatewayId = getGateway().id;
  } catch {
    return { ...report, active: false };
  }
  const db = getDb();
  const guarded = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      report.errors += 1;
      log().error('A billing task failed; it will be retried', { err: error });
    }
  };

  await guarded(async () => {
    report.orphansClosed = closeOrphans(db, now);
  });
  await guarded(async () => {
    report.checkoutsChecked = await reconcilePending(db, gatewayId, now, report);
  });
  await guarded(async () => withdrawOrphanedRenewals(db, now));
  await guarded(async () => {
    report.subscriptionsAdvanced = await advanceSubscriptions(db, now, report);
  });
  return report;
}

/** Checkouts without a payment page are crash leftovers: nobody could have paid them. */
function closeOrphans(db: Db, now: number): number {
  const stale = db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, 'pending'),
        isNull(orders.gatewayInvoiceId),
        lt(orders.createdAt, now - ORPHAN_AFTER_MS),
      ),
    )
    .limit(BATCH_SIZE)
    .all();
  let closed = 0;
  for (const order of stale) {
    if (withTx(db, (tx) => closeOrder(tx, order, 'failed', now))) closed += 1;
  }
  // An incomplete subscription with no open payment would block its owner for ever.
  const incomplete = db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, 'incomplete'),
        lt(subscriptions.createdAt, now - ORPHAN_AFTER_MS),
      ),
    )
    .limit(BATCH_SIZE)
    .all();
  for (const subscription of incomplete) {
    if (pendingOrderOf(db, subscription)) continue;
    withTx(db, (tx) =>
      tx
        .update(subscriptions)
        .set({ status: 'expired', nextChargeAt: null, updatedAt: now })
        .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.status, 'incomplete')))
        .run(),
    );
  }
  return closed;
}

async function reconcilePending(
  db: Db,
  gatewayId: string,
  now: number,
  report: TickReport,
): Promise<number> {
  const candidates = db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, 'pending'),
        eq(orders.gateway, gatewayId as 'mock' | 'moyasar'),
        isNotNull(orders.gatewayInvoiceId),
      ),
    )
    .orderBy(asc(orders.lastCheckedAt))
    .limit(BATCH_SIZE * 2)
    .all();

  let checked = 0;
  for (const order of candidates) {
    if (checked >= BATCH_SIZE) break;
    if (
      order.lastCheckedAt !== null &&
      now - order.lastCheckedAt < pollIntervalMs(now - order.createdAt)
    ) {
      continue;
    }
    const claimed = withTx(db, (tx) =>
      tx
        .update(orders)
        .set({ lastCheckedAt: now })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.status, 'pending'),
            order.lastCheckedAt === null
              ? isNull(orders.lastCheckedAt)
              : eq(orders.lastCheckedAt, order.lastCheckedAt),
          ),
        )
        .run(),
    );
    if (claimed.changes !== 1) continue;
    checked += 1;
    try {
      const result = await settleOrder(order.id, { now });
      const stillPending = result?.order.status === 'pending';
      if (stillPending && order.expiresAt !== null && now > order.expiresAt + EXPIRY_SLACK_MS) {
        await closeCheckout(order.id, 'failed', now);
      }
    } catch (error) {
      report.errors += 1;
      log().warn('Could not check a checkout; it will be tried again', {
        orderId: order.id,
        err: error,
      });
    }
  }
  return checked;
}

/** A renewal link whose subscription ended (canceled, refunded, expired) must stop being payable. */
async function withdrawOrphanedRenewals(db: Db, now: number): Promise<void> {
  const rows = db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(subscriptions, eq(subscriptions.id, orders.subscriptionId))
    .where(
      and(
        eq(orders.status, 'pending'),
        eq(orders.kind, 'subscription_renewal'),
        inArray(subscriptions.status, ['canceled', 'expired']),
      ),
    )
    .limit(BATCH_SIZE)
    .all();
  for (const row of rows) {
    try {
      await closeCheckout(row.id, 'canceled', now);
    } catch (error) {
      log().warn('Could not withdraw a renewal link of an ended subscription', {
        orderId: row.id,
        err: error,
      });
    }
  }
}

async function advanceSubscriptions(db: Db, now: number, report: TickReport): Promise<number> {
  const due = db
    .select()
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.status, ['active', 'past_due']),
        isNotNull(subscriptions.nextChargeAt),
        lte(subscriptions.nextChargeAt, now),
      ),
    )
    .orderBy(asc(subscriptions.nextChargeAt))
    .limit(BATCH_SIZE)
    .all();

  let advanced = 0;
  for (const candidate of due) {
    const lease = now + LEASE_MS;
    const claimed = withTx(db, (tx) =>
      tx
        .update(subscriptions)
        .set({ nextChargeAt: lease })
        .where(
          and(
            eq(subscriptions.id, candidate.id),
            inArray(subscriptions.status, ['active', 'past_due']),
            candidate.nextChargeAt === null
              ? isNull(subscriptions.nextChargeAt)
              : eq(subscriptions.nextChargeAt, candidate.nextChargeAt),
          ),
        )
        .run(),
    );
    if (claimed.changes !== 1) continue;
    try {
      await advanceSubscription(db, candidate.id, lease, now);
      advanced += 1;
    } catch (error) {
      // The lease expires and the next tick tries again.
      report.errors += 1;
      log().error('Could not advance a subscription; it will be retried', {
        subscriptionId: candidate.id,
        err: error,
      });
    }
  }
  return advanced;
}

function readSubscription(db: Db, id: string): SubscriptionRow | undefined {
  return db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
}

async function advanceSubscription(db: Db, id: string, lease: number, now: number): Promise<void> {
  const subscription = readSubscription(db, id);
  if (!subscription || (subscription.status !== 'active' && subscription.status !== 'past_due')) {
    return;
  }
  const pending = pendingOrderOf(db, subscription);
  const step = planStep(subscription, pending !== undefined, now);

  switch (step) {
    case 'issue_renewal':
      await issueRenewal(db, subscription, now);
      break;
    case 'mark_past_due':
      withTx(db, (tx) =>
        tx
          .update(subscriptions)
          .set({ status: 'past_due', updatedAt: now })
          .where(
            and(
              eq(subscriptions.id, id),
              eq(subscriptions.status, 'active'),
              lte(subscriptions.currentPeriodEnd, now),
            ),
          )
          .run(),
      );
      break;
    case 'expire':
      if (pending) await closeCheckout(pending.id, 'failed', now);
      withTx(db, (tx) =>
        tx
          .update(subscriptions)
          .set({ status: 'expired', nextChargeAt: null, updatedAt: now })
          .where(
            and(
              eq(subscriptions.id, id),
              eq(subscriptions.status, 'past_due'),
              lte(subscriptions.currentPeriodEnd, now - RENEWAL_GRACE_MS),
            ),
          )
          .run(),
      );
      break;
    case 'finalize_cancel':
      if (pending) await closeCheckout(pending.id, 'canceled', now);
      withTx(db, (tx) =>
        tx
          .update(subscriptions)
          .set({ status: 'canceled', canceledAt: now, nextChargeAt: null, updatedAt: now })
          .where(
            and(
              eq(subscriptions.id, id),
              inArray(subscriptions.status, ['active', 'past_due']),
              eq(subscriptions.cancelAtPeriodEnd, true),
              lte(subscriptions.currentPeriodEnd, now),
            ),
          )
          .run(),
      );
      break;
    case 'wait':
      break;
  }

  // Hand the subscription back with its next appointment, unless something else (a payment, the
  // user) already rewrote it while we worked.
  const after = readSubscription(db, id);
  if (!after || after.nextChargeAt !== lease) return;
  withTx(db, (tx) =>
    tx
      .update(subscriptions)
      .set({ nextChargeAt: nextWakeup(after, pendingOrderOf(db, after) !== undefined) })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.nextChargeAt, lease)))
      .run(),
  );
}

/** Creates the renewal order and its payment page. The price is the plan's CURRENT price. */
async function issueRenewal(db: Db, subscription: SubscriptionRow, now: number): Promise<void> {
  const plan = getPlan(subscription.planId);
  const periodEnd = subscription.currentPeriodEnd;
  if (periodEnd === null) return;
  if (!plan) {
    // The plan was removed from the price list: let the subscription end with the paid month.
    log().error(
      'A subscription refers to a plan that no longer exists; it will end with this month',
      {
        subscriptionId: subscription.id,
        planId: subscription.planId,
      },
    );
    withTx(db, (tx) =>
      tx
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true, updatedAt: now })
        .where(eq(subscriptions.id, subscription.id))
        .run(),
    );
    return;
  }
  const user = db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, subscription.userId))
    .get();
  if (!user) return;

  const gateway = getGateway();
  const vat = splitVat(plan.priceHalalas, getEnv().VAT_RATE_PERCENT);
  const orderId = newId('ord', now);
  try {
    withTx(db, (tx) =>
      tx
        .insert(orders)
        .values({
          id: orderId,
          userId: subscription.userId,
          kind: 'subscription_renewal',
          itemId: plan.id,
          amountHalalas: plan.priceHalalas,
          currency: 'SAR',
          vatHalalas: vat.vatHalalas,
          credits: plan.monthlyCredits,
          status: 'pending',
          gateway: gateway.id,
          subscriptionId: subscription.id,
          expiresAt: Math.max(periodEnd + RENEWAL_GRACE_MS, now + ORPHAN_AFTER_MS),
          createdAt: now,
          updatedAt: now,
        })
        .run(),
    );
  } catch (error) {
    // One open renewal per subscription (unique index): somebody else issued it.
    if (isUniqueViolation(error)) return;
    throw error;
  }
  await attachCheckout(
    db,
    orderId,
    {
      type: 'subscription',
      id: plan.id,
      credits: plan.monthlyCredits,
      priceHalalas: plan.priceHalalas,
      currency: 'SAR',
      name: plan.name,
    },
    user.locale,
    now,
  );
}

// ---- Running it inside the server process ----------------------------------------------------

const RUNTIME_KEY = Symbol.for('aivore.billingScheduler');
interface Runtime {
  timer: ReturnType<typeof setInterval>;
  current: Promise<unknown> | undefined;
}
type GlobalWithRuntime = typeof globalThis & { [RUNTIME_KEY]?: Runtime };

/** Starts the periodic tick in this process (once; further calls do nothing). */
export function startBillingScheduler(intervalMs: number = TICK_INTERVAL_MS): void {
  const scope = globalThis as GlobalWithRuntime;
  if (scope[RUNTIME_KEY]) return;
  const runtime: Runtime = {
    current: undefined,
    timer: setInterval(() => {
      if (runtime.current) return;
      runtime.current = tick()
        .catch((error: unknown) => log().error('Billing tick crashed', { err: error }))
        .finally(() => {
          runtime.current = undefined;
        });
    }, intervalMs),
  };
  runtime.timer.unref(); // never the reason the process stays alive
  scope[RUNTIME_KEY] = runtime;
}

/** Stops the periodic tick and waits for the one in flight. */
export async function stopBillingScheduler(): Promise<void> {
  const scope = globalThis as GlobalWithRuntime;
  const runtime = scope[RUNTIME_KEY];
  scope[RUNTIME_KEY] = undefined;
  if (!runtime) return;
  clearInterval(runtime.timer);
  await runtime.current;
}

export function isBillingSchedulerRunning(): boolean {
  return (globalThis as GlobalWithRuntime)[RUNTIME_KEY] !== undefined;
}
