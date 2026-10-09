import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import type { SubscriptionDTO } from '@/lib/api-types';
import { RENEWAL_LEAD_MS } from '@/lib/billing/period';
import { AppError } from '@/lib/errors';
import { getDb, withTx, type Db } from '@/server/db';
import { orders, subscriptions, type OrderRow, type SubscriptionRow } from '@/server/db/schema';
import { getLogger } from '@/server/logger';
import { toSubscriptionDTO } from './dto';
import { dispatchBillingMail, recordCanceled, recordResumed } from './mail';
import { liveSubscription } from './orders';
import { closeCheckout } from './settle';

const log = () => getLogger().child({ module: 'billing' });

/** The unpaid order of a subscription: its first month while incomplete, otherwise the next renewal. */
export function pendingOrderOf(db: Db, subscription: SubscriptionRow): OrderRow | undefined {
  if (
    subscription.status !== 'incomplete' &&
    subscription.status !== 'active' &&
    subscription.status !== 'past_due'
  ) {
    return undefined;
  }
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.subscriptionId, subscription.id),
        eq(
          orders.kind,
          subscription.status === 'incomplete' ? 'subscription_initial' : 'subscription_renewal',
        ),
        eq(orders.status, 'pending'),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .get();
}

/** The running subscription, otherwise the most recent one that ended (so the UI can say so), otherwise null. */
export function currentSubscription(
  userId: string,
  now: number = Date.now(),
): SubscriptionDTO | null {
  const db = getDb();
  const subscription =
    liveSubscription(db, userId) ??
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
      .get();
  return subscription
    ? toSubscriptionDTO(subscription, pendingOrderOf(db, subscription), now)
    : null;
}

function noSubscription(): AppError {
  return AppError.of('not_found', 'No subscription');
}

function ended(): AppError {
  return AppError.of('conflict', 'This subscription has ended; start a new one', {
    reason: 'subscription_ended',
  });
}

/**
 * The subscription ends when the month already paid does (credits never expire, so nothing is
 * lost); no renewal link is issued and the pending one is withdrawn. An unpaid first month is
 * simply abandoned, and a subscription that is already past due ends at once. Idempotent.
 */
export async function cancelSubscription(
  userId: string,
  now: number = Date.now(),
): Promise<SubscriptionDTO> {
  const db = getDb();
  let subscription = liveSubscription(db, userId);
  if (!subscription) throw noSubscription();

  if (subscription.status === 'incomplete') {
    const pending = pendingOrderOf(db, subscription);
    if (pending) await closeCheckout(pending.id, 'canceled', now);
    // The checkout may have been paid a moment ago, in which case the subscription now runs.
    subscription = liveSubscription(db, userId);
    if (!subscription) return currentSubscription(userId, now) ?? failMissing();
  }

  const running = subscription;
  withTx(db, (tx) => {
    if (running.status === 'past_due') {
      const ended = tx
        .update(subscriptions)
        .set({
          status: 'canceled',
          cancelAtPeriodEnd: true,
          canceledAt: now,
          nextChargeAt: null,
          updatedAt: now,
        })
        .where(and(eq(subscriptions.id, running.id), eq(subscriptions.status, 'past_due')))
        .run();
      // Whoever really changed it confirms it; a repeated cancel changes nothing and says nothing.
      if (ended.changes === 1) recordCanceled(tx, running, undefined, now);
    } else {
      const marked = tx
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true, nextChargeAt: running.currentPeriodEnd, updatedAt: now })
        .where(
          and(
            eq(subscriptions.id, running.id),
            eq(subscriptions.status, 'active'),
            eq(subscriptions.cancelAtPeriodEnd, false),
          ),
        )
        .run();
      if (marked.changes === 1) {
        recordCanceled(tx, running, running.currentPeriodEnd ?? undefined, now);
      }
    }
  });
  dispatchBillingMail({ db });

  // Withdraw the renewal link. If the gateway cannot do it now the cancellation still stands: the
  // scheduler finishes the job when the period ends.
  const renewal = pendingOrderOf(db, running);
  if (renewal) {
    try {
      await closeCheckout(renewal.id, 'canceled', now);
    } catch (error) {
      log().warn('Could not withdraw a renewal link while canceling a subscription', {
        subscriptionId: running.id,
        err: error,
      });
    }
  }
  return currentSubscription(userId, now) ?? failMissing();
}

function failMissing(): never {
  throw new Error('The subscription disappeared while it was being changed');
}

/** Undoes a cancellation that has not taken effect yet (the paid month is still running). */
export function resumeSubscription(userId: string, now: number = Date.now()): SubscriptionDTO {
  const db = getDb();
  const subscription = liveSubscription(db, userId);
  if (!subscription) {
    if (currentSubscription(userId, now)) throw ended();
    throw noSubscription();
  }
  if (subscription.status === 'incomplete') throw ended();
  if (!subscription.cancelAtPeriodEnd) return currentSubscription(userId, now) ?? failMissing();

  const periodEnd = subscription.currentPeriodEnd;
  if (subscription.status !== 'active' || periodEnd === null || periodEnd <= now) throw ended();
  const resumed = withTx(db, (tx) => {
    const flipped = tx
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: false,
        nextChargeAt: Math.max(periodEnd - RENEWAL_LEAD_MS, now),
        updatedAt: now,
      })
      .where(
        and(
          eq(subscriptions.id, subscription.id),
          eq(subscriptions.status, 'active'),
          eq(subscriptions.cancelAtPeriodEnd, true),
        ),
      )
      .run();
    if (flipped.changes === 1) recordResumed(tx, subscription, periodEnd, now);
    return flipped;
  });
  if (resumed.changes !== 1) throw ended();
  dispatchBillingMail({ db });
  return currentSubscription(userId, now) ?? failMissing();
}
