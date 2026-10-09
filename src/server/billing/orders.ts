import 'server-only';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { CheckoutRequest, OrderDTO, Page } from '@/lib/api-types';
import { CHECKOUT_TTL_MS, DAY_MS } from '@/lib/billing/period';
import { findPurchasable, splitVat, type Purchasable } from '@/lib/billing/plans';
import { LIVE_SUBSCRIPTION_STATUSES, type OrderKind } from '@/lib/billing/types';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { clamp, decodeCursor, encodeCursor } from '@/lib/utils';
import { getDb, withTx, type Db, type DbOrTx } from '@/server/db';
import {
  orders,
  subscriptions,
  users,
  type OrderRow,
  type SubscriptionRow,
} from '@/server/db/schema';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';
import { getGateway } from './config';
import { toOrderDTO } from './dto';
import { recordRenewalLink } from './mail';
import { closeCheckout, refreshOrder } from './settle';
import { closeOrder } from './transitions';

const log = () => getLogger().child({ module: 'billing' });

/** Open checkouts one account may hold at a time: each one is a hosted page at the gateway. */
export const MAX_PENDING_CHECKOUTS = 5;
/**
 * Checkouts one account may START in 24 hours (packs and first months, however they ended). The
 * limit on open checkouts cannot see a buyer who keeps switching plans, because every switch
 * closes the previous page; each of those still costs two gateway calls and two rows.
 */
export const MAX_CHECKOUTS_PER_DAY = 20;
/** A checkout row without a gateway page this old is the leftover of a crash, not a request in flight. */
export const ORPHAN_AFTER_MS = 2 * 60 * 1000;
/**
 * An open pack checkout is handed out again (see {@link findReusablePackCheckout}) only while its
 * payment page stays open at least this long: a buyer must not be sent to a page that closes
 * while they type their card.
 */
export const REUSE_MIN_REMAINING_MS = 30 * 60 * 1000;
/** Handing out an open checkout re-asks the gateway about it, but at most this often per order. */
const REUSE_CHECK_INTERVAL_MS = 3_000;

export const DEFAULT_ORDERS_PAGE = 20;
export const MAX_ORDERS_PAGE = 100;

export function isUniqueViolation(error: unknown, index?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, cause, message } = current as {
      code?: unknown;
      cause?: unknown;
      message?: unknown;
    };
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT_UNIQUE')) {
      return index === undefined || (typeof message === 'string' && message.includes(index));
    }
    current = cause;
  }
  return false;
}

export function findOrder(db: Db, orderId: string): OrderRow | undefined {
  return db.select().from(orders).where(eq(orders.id, orderId)).get();
}

/** The order if it belongs to `userId`; anybody else's id looks exactly like an unknown one. */
export function findOwnedOrder(db: Db, userId: string, orderId: string): OrderRow | undefined {
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .get();
}

export function listOrders(
  userId: string,
  options: { limit?: number; cursor?: string } = {},
  now: number = Date.now(),
): Page<OrderDTO> {
  const limit = clamp(Math.trunc(options.limit ?? DEFAULT_ORDERS_PAGE), 1, MAX_ORDERS_PAGE);
  let after: { createdAt: number; id: string } | undefined;
  if (options.cursor !== undefined) {
    const [createdAt, id] = decodeCursor(options.cursor) ?? [];
    if (typeof createdAt !== 'number' || typeof id !== 'string') {
      throw AppError.of('bad_request', 'Invalid cursor');
    }
    after = { createdAt, id };
  }
  const rows = getDb()
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        after
          ? or(
              lt(orders.createdAt, after.createdAt),
              and(eq(orders.createdAt, after.createdAt), lt(orders.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit + 1)
    .all();
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    data: pageRows.map((row) => toOrderDTO(row, now)),
    nextCursor: rows.length > limit && last ? encodeCursor([last.createdAt, last.id]) : null,
  };
}

function conflict(reason: string, message: string): AppError {
  return AppError.of('conflict', message, { reason });
}

function sameRequest(order: OrderRow, kind: OrderKind, itemId: string): boolean {
  return order.kind === kind && order.itemId === itemId;
}

export interface CheckoutResult {
  order: OrderRow;
  /** False when an earlier request (same `Idempotency-Key`, or the same open subscription checkout) is returned. */
  created: boolean;
}

/**
 * Starts a purchase. The price, VAT, credits and currency come from `lib/billing/plans.ts` and the
 * environment only; the request names an item, never an amount. Order of events:
 *   1. a retry with the same `Idempotency-Key` gets the original order back;
 *   2. ONE transaction inserts the pending order (and, for a plan, its incomplete subscription), so
 *      the account limits and the one-subscription rule hold under concurrency;
 *   3. the gateway creates the hosted payment page (the only await);
 *   4. a compare-and-set stores its id and URL on the still-pending order.
 * A crash between 2 and 4 leaves a pending order without a page, which nobody can pay and the
 * scheduler closes; a page the buyer never received cannot take money.
 */
export async function createCheckout(
  userId: string,
  request: CheckoutRequest,
  options: { idempotencyKey: string; now?: number },
): Promise<CheckoutResult> {
  const now = options.now ?? Date.now();
  const gateway = getGateway();
  const item = findPurchasable(request.type, request.id);
  if (!item) throw AppError.of('not_found', 'Unknown item');
  const kind: OrderKind = request.type === 'pack' ? 'pack' : 'subscription_initial';
  const db = getDb();

  const user = db
    .select({ locale: users.locale, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user || user.disabledAt !== null) throw AppError.of('forbidden', 'This account cannot buy');

  const replay = await replayExisting(db, userId, options.idempotencyKey, kind, item.id, now);
  if (replay) return { order: replay, created: false };

  // A buyer who comes back to the same pack (a declined card, a closed tab) gets the payment page
  // they already have, not a sixth unpaid order that would lock them out of buying for a day.
  if (request.type === 'pack') {
    const open = findReusablePackCheckout(db, userId, item, gateway.id, now);
    if (open) {
      // The buyer may have paid on that page a moment ago: say what is true, not what we heard last.
      const latest = await refreshOrder(open.id, { minIntervalMs: REUSE_CHECK_INTERVAL_MS, now })
        .then((result) => result?.order ?? open)
        .catch(() => open);
      if (latest.status === 'pending' || latest.status === 'paid') {
        return { order: latest, created: false };
      }
      // Closed meanwhile (failed, canceled): this click starts a new checkout.
    }
  }

  // Before anything is closed on the buyer's behalf (a plan switch abandons the open checkout).
  assertCheckoutsPerDay(db, userId, now);
  if (request.type === 'subscription') {
    const reusable = await prepareSubscriptionCheckout(db, userId, item, now);
    if (reusable) return { order: reusable, created: false };
  }

  const vat = splitVat(item.priceHalalas, getEnv().VAT_RATE_PERCENT);
  const orderId = newId('ord', now);
  const subscriptionId = request.type === 'subscription' ? newId('sub', now) : null;
  try {
    withTx(db, (tx) => {
      const open = tx
        .select({ total: count() })
        .from(orders)
        .where(
          and(
            eq(orders.userId, userId),
            eq(orders.status, 'pending'),
            gt(orders.createdAt, now - CHECKOUT_TTL_MS),
          ),
        )
        .get();
      if ((open?.total ?? 0) >= MAX_PENDING_CHECKOUTS) {
        throw new AppError('too_many_active', 429, 'Too many unpaid checkouts', {
          limit: MAX_PENDING_CHECKOUTS,
        });
      }
      assertCheckoutsPerDay(tx, userId, now);
      if (subscriptionId !== null) {
        tx.insert(subscriptions)
          .values({
            id: subscriptionId,
            userId,
            planId: item.id,
            status: 'incomplete',
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
      tx.insert(orders)
        .values({
          id: orderId,
          userId,
          kind,
          itemId: item.id,
          amountHalalas: item.priceHalalas,
          currency: item.currency,
          vatHalalas: vat.vatHalalas,
          credits: item.credits,
          status: 'pending',
          gateway: gateway.id,
          subscriptionId,
          idempotencyKey: options.idempotencyKey,
          expiresAt: now + CHECKOUT_TTL_MS,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  } catch (error) {
    if (isUniqueViolation(error, 'subscriptions.user_id')) {
      throw conflict('subscription_exists', 'You already have a subscription');
    }
    if (isUniqueViolation(error)) {
      // A concurrent request with the same key won the race; answer like a retry.
      const winner = await replayExisting(db, userId, options.idempotencyKey, kind, item.id, now);
      if (winner) return { order: winner, created: false };
    }
    throw error;
  }

  return { order: await attachCheckout(db, orderId, item, user.locale, now), created: true };
}

/**
 * The account's own open checkout of this very pack, if it can still be paid: same item at the
 * same price and credits as the price list says NOW (a changed price starts a new order), made
 * with the gateway that is running, with a payment page that stays open for a while yet.
 */
function findReusablePackCheckout(
  db: Db,
  userId: string,
  item: Purchasable,
  gatewayId: string,
  now: number,
): OrderRow | undefined {
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.kind, 'pack'),
        eq(orders.itemId, item.id),
        eq(orders.status, 'pending'),
        eq(orders.gateway, gatewayId as 'mock' | 'moyasar'),
        eq(orders.amountHalalas, item.priceHalalas),
        eq(orders.credits, item.credits),
        isNotNull(orders.gatewayInvoiceId),
        isNotNull(orders.checkoutUrl),
        gt(orders.expiresAt, now + REUSE_MIN_REMAINING_MS),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1)
    .get();
}

/** 429 when the account already started {@link MAX_CHECKOUTS_PER_DAY} checkouts in the last 24 hours. */
function assertCheckoutsPerDay(db: DbOrTx, userId: string, now: number): void {
  const recent = db
    .select({ createdAt: orders.createdAt })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        inArray(orders.kind, ['pack', 'subscription_initial']),
        gt(orders.createdAt, now - DAY_MS),
      ),
    )
    .orderBy(asc(orders.createdAt))
    .limit(MAX_CHECKOUTS_PER_DAY)
    .all();
  const oldest = recent[0];
  if (recent.length < MAX_CHECKOUTS_PER_DAY || !oldest) return;
  throw new AppError('rate_limited', 429, 'Too many checkouts today', {
    reason: 'daily_checkout_limit',
    limit: MAX_CHECKOUTS_PER_DAY,
    retryAfterSec: Math.max(1, Math.ceil((oldest.createdAt + DAY_MS - now) / 1000)),
  });
}

/**
 * Step 3 and 4 of {@link createCheckout}, also used for renewal links. A gateway failure fails the
 * order (and a first month's subscription with it).
 */
export async function attachCheckout(
  db: Db,
  orderId: string,
  item: Purchasable,
  locale: 'ar' | 'en',
  now: number,
): Promise<OrderRow> {
  const order = findOrder(db, orderId);
  if (!order) throw new Error(`Order ${orderId} vanished`);
  const gateway = getGateway();
  const appUrl = getEnv().APP_URL;
  const returnUrl = `${appUrl}/api/v1/billing/return?order=${encodeURIComponent(order.id)}`;

  let checkout;
  try {
    checkout = await gateway.createCheckout({
      orderId: order.id,
      amountHalalas: order.amountHalalas,
      currency: 'SAR',
      description: `AIVORE - ${item.name[locale]}`,
      successUrl: returnUrl,
      backUrl: returnUrl,
      expiresAt: order.expiresAt ?? now + CHECKOUT_TTL_MS,
    });
  } catch (error) {
    withTx(db, (tx) => closeOrder(tx, order, 'failed', now));
    throw error;
  }

  const stored = withTx(db, (tx) => {
    const attached = tx
      .update(orders)
      .set({
        gatewayInvoiceId: checkout.invoiceId,
        checkoutUrl: checkout.checkoutUrl,
        updatedAt: now,
      })
      .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
      .run();
    // A renewal's payment page is what the buyer is emailed; the row is written with the page.
    if (attached.changes === 1) recordRenewalLink(tx, order, now);
    return attached;
  });
  if (stored.changes !== 1) {
    // The order was closed while the page was being made: take the page down again.
    await gateway.cancelCheckout(checkout.invoiceId).catch((error: unknown) => {
      log().error('A checkout page was created for an order that is no longer pending', {
        orderId: order.id,
        err: error,
      });
    });
    throw conflict('checkout_closed', 'This checkout was closed while it was being created');
  }
  const fresh = findOrder(db, order.id);
  if (!fresh) throw new Error(`Order ${order.id} vanished`);
  return fresh;
}

/**
 * Looks for an earlier request with the same `Idempotency-Key`. The same key for another item is a
 * client bug (409). An order without a checkout page yet is a request still in flight (409
 * `checkout_in_progress`, retry shortly) or, after {@link ORPHAN_AFTER_MS}, a crash leftover that is closed here.
 * A request that FAILED before the buyer was ever offered a payment page (the gateway was down) is
 * not replayed: handing back that dead order would answer a retry with an empty "success". The
 * failed order gives the key up and the retry starts a fresh checkout, so the key means "this
 * purchase" until a payment page exists for it.
 */
async function replayExisting(
  db: Db,
  userId: string,
  key: string,
  kind: OrderKind,
  itemId: string,
  now: number,
): Promise<OrderRow | null> {
  let existing = db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, key)))
    .get();
  if (!existing) return null;
  if (!sameRequest(existing, kind, itemId)) {
    throw conflict(
      'idempotency_key_reused',
      'This Idempotency-Key was already used for another purchase',
    );
  }
  if (existing.status === 'pending' && existing.gatewayInvoiceId === null) {
    if (now - existing.createdAt < ORPHAN_AFTER_MS) {
      throw conflict(
        'checkout_in_progress',
        'This checkout is still being created, retry in a moment',
      );
    }
    await closeCheckout(existing.id, 'failed', now);
    existing = findOrder(db, existing.id) ?? existing;
  }
  if (existing.status === 'failed' && existing.gatewayInvoiceId === null) {
    withTx(db, (tx) =>
      tx
        .update(orders)
        .set({ idempotencyKey: null, updatedAt: now })
        .where(
          and(
            eq(orders.id, existing.id),
            eq(orders.status, 'failed'),
            isNull(orders.gatewayInvoiceId),
          ),
        )
        .run(),
    );
    return null;
  }
  return existing;
}

/**
 * Before a second plan checkout: an open, unpaid first month of the SAME plan is simply returned
 * (the buyer re-opens their payment page); one for another plan is abandoned first; a running
 * subscription is a conflict. Returns the order to hand back, if any.
 */
async function prepareSubscriptionCheckout(
  db: Db,
  userId: string,
  item: Purchasable,
  now: number,
): Promise<OrderRow | null> {
  const live = liveSubscription(db, userId);
  if (!live) return null;
  if (live.status !== 'incomplete') {
    throw conflict('subscription_exists', 'You already have a subscription');
  }
  const pending = db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.subscriptionId, live.id),
        eq(orders.kind, 'subscription_initial'),
        eq(orders.status, 'pending'),
      ),
    )
    .get();
  if (pending && live.planId === item.id && pending.checkoutUrl !== null) {
    if (pending.expiresAt === null || pending.expiresAt > now) return pending;
  }
  if (pending) {
    await closeCheckout(pending.id, 'canceled', now);
  } else {
    // An incomplete subscription without an open payment would block this account for ever.
    withTx(db, (tx) =>
      tx
        .update(subscriptions)
        .set({ status: 'expired', nextChargeAt: null, updatedAt: now })
        .where(and(eq(subscriptions.id, live.id), eq(subscriptions.status, 'incomplete')))
        .run(),
    );
  }
  // The abandoned checkout may have turned out to be paid: then the subscription is running.
  const after = liveSubscription(db, userId);
  if (after) throw conflict('subscription_exists', 'You already have a subscription');
  return null;
}

export function liveSubscription(db: Db, userId: string): SubscriptionRow | undefined {
  return db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
      ),
    )
    .get();
}
