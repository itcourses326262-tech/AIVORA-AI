import 'server-only';
import { and, eq } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import { onAccountDeleted } from '@/server/auth/account-hooks';
import { getDb, withTx, type Db } from '@/server/db';
import { orders, type OrderRow } from '@/server/db/schema';
import { getLogger } from '@/server/logger';
import { liveSubscription } from './orders';
import { closeCheckout } from './settle';
import { closeOrder, endSubscriptionNow } from './transitions';

/**
 * What billing owes an account that is being deleted: nothing may keep charging it, and nobody may
 * be able to pay for it any more. {@link registerBillingAccountHook} plugs this into
 * `onAccountDeleted` (the auth module runs the hooks BEFORE it destroys anything and refuses the
 * deletion when one fails, so the user can simply try again).
 */

const log = () => getLogger().child({ module: 'billing' });

export const BILLING_ACCOUNT_HOOK = 'billing';

export interface AccountBillingEnd {
  /** Unpaid checkouts that were withdrawn. */
  checkoutsWithdrawn: number;
  /** A subscription that was running (or waiting for its first payment) has been ended. */
  subscriptionEnded: boolean;
}

function pendingOrders(db: Db, userId: string): OrderRow[] {
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.status, 'pending')))
    .all();
}

function isBillingOff(error: unknown): boolean {
  return (
    error instanceof AppError &&
    typeof error.details === 'object' &&
    error.details !== null &&
    (error.details as { reason?: unknown }).reason === 'billing_disabled'
  );
}

/**
 * Takes every open payment page of the user down at the gateway. Throws when one could not be
 * withdrawn (the gateway is down, or the page belongs to another gateway than this process uses):
 * a page that stays payable is exactly what this must not leave behind.
 */
async function withdrawCheckouts(db: Db, userId: string, now: number): Promise<void> {
  let firstError: unknown;
  for (const order of pendingOrders(db, userId)) {
    try {
      await closeCheckout(order.id, 'canceled', now);
    } catch (error) {
      if (isBillingOff(error)) {
        // Billing is switched off, so the gateway cannot be asked. Nothing can be paid through us
        // meanwhile, and a payment that shows up later for a deleted account is never credited
        // (settle.ts parks it for a person).
        log().warn(
          'Billing is off: a checkout of a deleted account was closed without the gateway',
          {
            orderId: order.id,
          },
        );
        withTx(db, (tx) => closeOrder(tx, order, 'canceled', now));
      } else {
        firstError ??= error;
        log().error('A checkout of an account being deleted could not be withdrawn', {
          orderId: order.id,
          err: error,
        });
      }
    }
  }
  const stillOpen = pendingOrders(db, userId);
  if (stillOpen.length > 0) {
    throw firstError instanceof Error
      ? firstError
      : AppError.of(
          'provider_error',
          `${stillOpen.length} open payment page(s) could not be withdrawn. They were made with a different payment gateway than this process uses; on the production host run the command with NODE_ENV=production.`,
        );
  }
}

/**
 * Ends all billing of one account. Idempotent. Order matters: the payment pages go first (they
 * can fail, and a failure must leave a still-living account untouched; a page paid a moment ago is
 * credited by `closeCheckout` and the first month is then ended below), then the subscription (a
 * database change that cannot fail), then a second look for a renewal link the scheduler issued in
 * between. Credits already granted stay: the ledger is accounting history.
 */
export async function endBillingForAccount(
  userId: string,
  now: number = Date.now(),
): Promise<AccountBillingEnd> {
  const db = getDb();
  const before = pendingOrders(db, userId).length;
  await withdrawCheckouts(db, userId, now);

  const subscription = liveSubscription(db, userId);
  const subscriptionEnded =
    subscription !== undefined && withTx(db, (tx) => endSubscriptionNow(tx, subscription.id, now));

  await withdrawCheckouts(db, userId, now);
  const result = { checkoutsWithdrawn: before, subscriptionEnded };
  if (before > 0 || subscriptionEnded) {
    log().info('Billing ended for a deleted account', { userId, ...result });
  }
  return result;
}

/**
 * Registers the account-deletion hook (not at import time: called from the start-up code of every
 * process that can delete an account, i.e. the server and the admin CLI). Returns the unregister function.
 */
export function registerBillingAccountHook(): () => void {
  return onAccountDeleted(BILLING_ACCOUNT_HOOK, async ({ userId }) => {
    await endBillingForAccount(userId);
  });
}
