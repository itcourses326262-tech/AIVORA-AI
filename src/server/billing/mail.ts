import 'server-only';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { checkoutTarget } from '@/components/billing/navigation';
import { RENEWAL_GRACE_MS, RENEWAL_LEAD_MS } from '@/lib/billing/period';
import { getPlan } from '@/lib/billing/plans';
import { ORDER_KINDS } from '@/lib/billing/types';
import { readCompanyInfo } from '@/lib/legal';
import type { Locale } from '@/lib/i18n/locales';
import { getDb, type Db, type DbOrTx } from '@/server/db';
import {
  emailEvents,
  orders,
  subscriptions,
  users,
  type EmailEventRow,
  type OrderRow,
  type SubscriptionRow,
} from '@/server/db/schema';
import { appLink, queueEmail, renderEmail, type EmailSpec } from '@/server/email';
import { itemLabel } from '@/server/email/templates/billing';
import type { BillingEmailKind } from '@/server/email/types';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';

/**
 * The mails billing sends when money or a plan changes state: a receipt, the renewal link, the
 * overdue reminder, the expiry notice, the refund notice and the cancel / resume confirmations.
 *
 * Exactly once, in three steps:
 *  1. RECORD. The function for the change inserts a row into `email_events` inside the SAME
 *     transaction that makes the change, keyed by what the change is (`receipt:<order>`,
 *     `refund:<order>:<refunded total>`, ...). The change itself is a compare-and-set, so a
 *     replayed webhook, a restarted scheduler or a second process finds it already made and
 *     records nothing; the unique key is the second line of defence. Nothing is sent from inside
 *     the transaction, and a failure to record is logged, never thrown: money state comes first.
 *  2. CLAIM. After the commit, {@link dispatchBillingMail} claims each unsent row with a
 *     compare-and-set on `sent_at`. Only the process that wins renders and queues the message, so
 *     two processes never both send it.
 *  3. SEND. `queueEmail` hands the message to the event loop. A relay that is down is logged by the
 *     email module and never reaches the caller. A process that dies between the commit and the
 *     claim leaves the row unclaimed, and the scheduler's next tick dispatches it; one that dies
 *     between the claim and the delivery loses that one message (at most once, never twice). The
 *     email module upholds the same promise on its side: a billing message whose attempt ran into
 *     the delivery deadline is not repeated, because the relay may still accept that attempt
 *     (reported as failed, outcome unknown).
 *
 * The facts a message states are frozen in the row when the change is made; the address, name and
 * language are read when it is sent, so the mail follows an account that changed its language and
 * is never sent to an anonymized (deleted) account.
 */

const log = () => getLogger().child({ module: 'billing-mail' });

/** Most rows one dispatch pass claims; the rest wait for the next pass. */
const DISPATCH_BATCH = 25;

const timestamp = z.number().int().nonnegative();
const money = z.number().int().nonnegative();

const factsSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('payment_receipt'),
    orderId: z.string(),
    orderKind: z.enum(ORDER_KINDS),
    itemId: z.string(),
    amountHalalas: money,
    vatHalalas: money,
    credits: money,
    paidAt: timestamp,
    periodEnd: timestamp.optional(),
  }),
  z.object({
    kind: z.literal('renewal_link'),
    orderId: z.string(),
    planId: z.string(),
    amountHalalas: money,
    credits: money,
    dueAt: timestamp,
    graceEndsAt: timestamp,
  }),
  z.object({
    kind: z.literal('payment_overdue'),
    orderId: z.string().optional(),
    subscriptionId: z.string(),
    planId: z.string(),
    amountHalalas: money,
    dueAt: timestamp,
    graceEndsAt: timestamp,
  }),
  z.object({
    kind: z.literal('subscription_expired'),
    subscriptionId: z.string(),
    planId: z.string(),
  }),
  z.object({
    kind: z.literal('refund_notice'),
    orderId: z.string(),
    itemId: z.string(),
    refundedHalalas: money,
    refundedTotalHalalas: money,
    orderAmountHalalas: money,
    creditsTakenBack: money,
    credited: z.boolean(),
    planEnded: z.boolean(),
  }),
  z.object({
    kind: z.literal('subscription_canceled'),
    subscriptionId: z.string(),
    planId: z.string(),
    endsAt: timestamp.optional(),
  }),
  z.object({
    kind: z.literal('subscription_resumed'),
    subscriptionId: z.string(),
    planId: z.string(),
    renewsAt: timestamp,
  }),
]);

type Facts = z.infer<typeof factsSchema>;

// ---- 1. Recording (inside the transaction of the change) ------------------------------------

interface Recorded {
  /** `<what>:<subject>[:<detail>]`, unique: a second record of the same change is ignored. */
  key: string;
  userId: string;
  /** The order or subscription the message is about. */
  subject: string;
  facts: Facts;
  now: number;
}

/**
 * Inserts the row for one change. Returns false when the row already existed (a change recorded
 * twice) or could not be written; never throws, so a problem with mail cannot undo the money.
 */
function record(tx: DbOrTx, entry: Recorded): boolean {
  try {
    const inserted = tx
      .insert(emailEvents)
      .values({
        key: entry.key,
        userId: entry.userId,
        kind: entry.facts.kind,
        subject: entry.subject,
        payload: JSON.stringify(entry.facts),
        createdAt: entry.now,
      })
      .onConflictDoNothing({ target: emailEvents.key })
      .run();
    return inserted.changes === 1;
  } catch (error) {
    log().error('Could not record a billing email; the change itself is unaffected', {
      kind: entry.facts.kind,
      subject: entry.subject,
      err: error,
    });
    return false;
  }
}

/** The next free number for changes that can repeat on one subscription (cancel, resume, cancel...). */
function nextSequence(tx: DbOrTx, kind: BillingEmailKind, subject: string): number {
  const row = tx
    .select({ total: count() })
    .from(emailEvents)
    .where(and(eq(emailEvents.subject, subject), eq(emailEvents.kind, kind)))
    .get();
  return (row?.total ?? 0) + 1;
}

/** A payment was credited. Called by `markPaid`, in its transaction. */
export function recordReceipt(
  tx: DbOrTx,
  order: OrderRow,
  now: number,
  periodEnd: number | undefined,
): void {
  record(tx, {
    key: `receipt:${order.id}`,
    userId: order.userId,
    subject: order.id,
    now,
    facts: {
      kind: 'payment_receipt',
      orderId: order.id,
      orderKind: order.kind,
      itemId: order.itemId,
      amountHalalas: order.amountHalalas,
      vatHalalas: order.vatHalalas,
      credits: order.credits,
      paidAt: now,
      ...(periodEnd === undefined ? {} : { periodEnd }),
    },
  });
}

/** The payment page of a renewal was attached to its order. Called by `attachCheckout`. */
export function recordRenewalLink(tx: DbOrTx, order: OrderRow, now: number): void {
  if (order.kind !== 'subscription_renewal' || order.subscriptionId === null) return;
  const subscription = tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, order.subscriptionId))
    .get();
  const dueAt = subscription?.currentPeriodEnd;
  if (!subscription || dueAt === null || dueAt === undefined) return;
  record(tx, {
    key: `renewal_link:${order.id}`,
    userId: order.userId,
    subject: order.id,
    now,
    facts: {
      kind: 'renewal_link',
      orderId: order.id,
      planId: order.itemId,
      amountHalalas: order.amountHalalas,
      credits: order.credits,
      dueAt,
      graceEndsAt: dueAt + RENEWAL_GRACE_MS,
    },
  });
}

/** An unpaid renewal turned the subscription `past_due`. Once per month that goes unpaid. */
export function recordPastDue(
  tx: DbOrTx,
  subscription: SubscriptionRow,
  renewal: OrderRow | undefined,
  now: number,
): void {
  const dueAt = subscription.currentPeriodEnd;
  if (dueAt === null) return;
  record(tx, {
    key: `payment_overdue:${subscription.id}:${dueAt}`,
    userId: subscription.userId,
    subject: subscription.id,
    now,
    facts: {
      kind: 'payment_overdue',
      subscriptionId: subscription.id,
      planId: subscription.planId,
      ...(renewal ? { orderId: renewal.id } : {}),
      amountHalalas: renewal?.amountHalalas ?? getPlan(subscription.planId)?.priceHalalas ?? 0,
      dueAt,
      graceEndsAt: dueAt + RENEWAL_GRACE_MS,
    },
  });
}

/** The grace period ended unpaid and the subscription expired. Once per subscription. */
export function recordExpired(tx: DbOrTx, subscription: SubscriptionRow, now: number): void {
  record(tx, {
    key: `subscription_expired:${subscription.id}`,
    userId: subscription.userId,
    subject: subscription.id,
    now,
    facts: {
      kind: 'subscription_expired',
      subscriptionId: subscription.id,
      planId: subscription.planId,
    },
  });
}

export interface RefundFacts {
  /** What this refund returned (the new total minus the old one). */
  refundedHalalas: number;
  /** Credits this refund took back (0 when none had been granted or none were left). */
  creditsTakenBack: number;
  /** The credits had been granted before the money went back. */
  credited: boolean;
  /** The subscription this payment funded ended with it. */
  planEnded: boolean;
}

/**
 * Money went back to the buyer. One mail per refunded TOTAL, so a second partial refund is its own
 * message and a redelivered event is not. Whether the credits taken back were all there were is
 * deliberately not part of the message (that is the operator's `needs_review` queue).
 */
export function recordRefund(tx: DbOrTx, order: OrderRow, refund: RefundFacts, now: number): void {
  record(tx, {
    key: `refund:${order.id}:${order.refundedHalalas + refund.refundedHalalas}`,
    userId: order.userId,
    subject: order.id,
    now,
    facts: {
      kind: 'refund_notice',
      orderId: order.id,
      itemId: order.itemId,
      refundedHalalas: refund.refundedHalalas,
      refundedTotalHalalas: order.refundedHalalas + refund.refundedHalalas,
      orderAmountHalalas: order.amountHalalas,
      creditsTakenBack: refund.creditsTakenBack,
      credited: refund.credited,
      planEnded: refund.planEnded,
    },
  });
}

/**
 * The user canceled a plan that was running (`endsAt` = the end of the paid month) or overdue
 * (`endsAt` absent: it ended at once). Cancel and resume can alternate, so each real change gets
 * the next number; the change itself is the compare-and-set that decides who records it.
 */
export function recordCanceled(
  tx: DbOrTx,
  subscription: SubscriptionRow,
  endsAt: number | undefined,
  now: number,
): void {
  const sequence = nextSequence(tx, 'subscription_canceled', subscription.id);
  record(tx, {
    key: `subscription_canceled:${subscription.id}:${sequence}`,
    userId: subscription.userId,
    subject: subscription.id,
    now,
    facts: {
      kind: 'subscription_canceled',
      subscriptionId: subscription.id,
      planId: subscription.planId,
      ...(endsAt === undefined ? {} : { endsAt }),
    },
  });
}

/** The user took a cancellation back while the paid month was still running. */
export function recordResumed(
  tx: DbOrTx,
  subscription: SubscriptionRow,
  renewsAt: number,
  now: number,
): void {
  const sequence = nextSequence(tx, 'subscription_resumed', subscription.id);
  record(tx, {
    key: `subscription_resumed:${subscription.id}:${sequence}`,
    userId: subscription.userId,
    subject: subscription.id,
    now,
    facts: {
      kind: 'subscription_resumed',
      subscriptionId: subscription.id,
      planId: subscription.planId,
      renewsAt,
    },
  });
}

// ---- 2. and 3. Claiming and sending (after the commit) -----------------------------------------

/** A payment page we may put in a message: https, or a page of this very site. */
function safePaymentLink(raw: string | null): string | null {
  return checkoutTarget(raw ?? undefined, new URL(getEnv().APP_URL).origin);
}

function pendingRenewal(db: DbOrTx, orderId: string | undefined): OrderRow | undefined {
  if (orderId === undefined) return undefined;
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  return order && order.status === 'pending' ? order : undefined;
}

interface Recipient {
  to: string;
  name: string;
  locale: Locale;
}

/**
 * The message for one recorded change, or null when it no longer applies: the account is gone,
 * or the world moved on while the row waited (a renewal link that was paid or withdrawn, a
 * subscription that is no longer overdue). Pure apart from reading the database.
 */
export function buildBillingSpec(
  db: DbOrTx,
  facts: Facts,
  who: Recipient,
  now: number,
): EmailSpec | null {
  const common = {
    locale: who.locale,
    to: who.to,
    name: who.name,
    billingLink: appLink('/account/billing'),
    ...supportOf(),
  };
  switch (facts.kind) {
    case 'payment_receipt':
      return {
        ...common,
        kind: 'payment_receipt',
        item: itemLabel(facts.itemId, who.locale),
        reference: facts.orderId,
        amountHalalas: facts.amountHalalas,
        vatHalalas: facts.vatHalalas,
        credits: facts.credits,
        paidAt: facts.paidAt,
        ...(facts.periodEnd === undefined ? {} : { paidUntil: facts.periodEnd }),
        plan: facts.orderKind !== 'pack',
        renewal: facts.orderKind === 'subscription_renewal',
        leadDays: RENEWAL_LEAD_MS / (24 * 60 * 60 * 1000),
      };
    case 'renewal_link': {
      const order = pendingRenewal(db, facts.orderId);
      if (!order) return null;
      const link = safePaymentLink(order.checkoutUrl);
      if (link === null) {
        log().warn(
          'A renewal link has no payment page that is safe to email; pointing to Billing',
          {
            orderId: order.id,
          },
        );
      }
      if (facts.dueAt <= now) {
        // A replacement link issued after the month ended (the first one was withdrawn at the
        // gateway while the plan was overdue): "renews on <a date in the past>" would be wrong, so it
        // goes out as what it is, the overdue notice with the new link.
        return {
          ...common,
          kind: 'payment_overdue',
          item: itemLabel(facts.planId, who.locale),
          amountHalalas: facts.amountHalalas,
          dueAt: facts.dueAt,
          graceEndsAt: facts.graceEndsAt,
          ...(link === null ? {} : { link }),
        };
      }
      return {
        ...common,
        kind: 'renewal_link',
        item: itemLabel(facts.planId, who.locale),
        amountHalalas: facts.amountHalalas,
        credits: facts.credits,
        dueAt: facts.dueAt,
        graceEndsAt: facts.graceEndsAt,
        link: link ?? common.billingLink,
      };
    }
    case 'payment_overdue': {
      const subscription = db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, facts.subscriptionId))
        .get();
      if (subscription?.status !== 'past_due') return null;
      const renewal = pendingRenewal(db, facts.orderId);
      const link = renewal ? safePaymentLink(renewal.checkoutUrl) : null;
      return {
        ...common,
        kind: 'payment_overdue',
        item: itemLabel(facts.planId, who.locale),
        amountHalalas: facts.amountHalalas,
        dueAt: facts.dueAt,
        graceEndsAt: facts.graceEndsAt,
        ...(link === null ? {} : { link }),
      };
    }
    case 'subscription_expired':
      return {
        ...common,
        kind: 'subscription_expired',
        item: itemLabel(facts.planId, who.locale),
        pricingLink: appLink('/pricing'),
      };
    case 'refund_notice':
      return {
        ...common,
        kind: 'refund_notice',
        item: itemLabel(facts.itemId, who.locale),
        reference: facts.orderId,
        refundedHalalas: facts.refundedHalalas,
        refundedTotalHalalas: facts.refundedTotalHalalas,
        orderAmountHalalas: facts.orderAmountHalalas,
        creditsTakenBack: facts.creditsTakenBack,
        credited: facts.credited,
        planEnded: facts.planEnded,
      };
    case 'subscription_canceled':
      return {
        ...common,
        kind: 'subscription_canceled',
        item: itemLabel(facts.planId, who.locale),
        ...(facts.endsAt === undefined ? {} : { endsAt: facts.endsAt }),
      };
    case 'subscription_resumed':
      return {
        ...common,
        kind: 'subscription_resumed',
        item: itemLabel(facts.planId, who.locale),
        renewsAt: facts.renewsAt,
        leadDays: RENEWAL_LEAD_MS / (24 * 60 * 60 * 1000),
      };
  }
}

function supportOf(): { supportEmail?: string } {
  const address = readCompanyInfo().supportEmail;
  return address === null ? {} : { supportEmail: address };
}

/** Anonymized accounts keep a placeholder address nobody can read. */
function recipientOf(db: DbOrTx, userId: string): Recipient | null {
  const user = db
    .select({
      email: users.email,
      name: users.name,
      locale: users.locale,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user || user.deletedAt !== null) return null;
  return { to: user.email, name: user.name, locale: user.locale };
}

function deliver(db: DbOrTx, row: EmailEventRow, now: number): boolean {
  const parsed = factsSchema.safeParse(JSON.parse(row.payload));
  if (!parsed.success) {
    log().error('A recorded billing email has unreadable facts and was dropped', {
      key: row.key,
      kind: row.kind,
    });
    return false;
  }
  const who = recipientOf(db, row.userId);
  if (!who) return false;
  const spec = buildBillingSpec(db, parsed.data, who, now);
  if (!spec) {
    log().debug('A billing email no longer applies and was not sent', { kind: row.kind });
    return false;
  }
  queueEmail(renderEmail(spec));
  return true;
}

/**
 * Sends the billing mails that were recorded and not sent yet: claim each row (compare-and-set on
 * `sent_at`), build the message from the facts frozen in the row and the account as it is now,
 * queue it. Call it after the transaction that recorded something committed, and from the
 * scheduler's tick, which also picks up what a crashed process left behind. Returns how many
 * messages were queued. Never throws and never waits for the relay.
 */
export function dispatchBillingMail(
  options: { db?: Db; now?: number; limit?: number } = {},
): number {
  let queued = 0;
  try {
    const db = options.db ?? getDb();
    const now = options.now ?? Date.now();
    const due = db
      .select()
      .from(emailEvents)
      .where(isNull(emailEvents.sentAt))
      .orderBy(asc(emailEvents.createdAt))
      .limit(options.limit ?? DISPATCH_BATCH)
      .all();
    for (const row of due) {
      const claimed = db
        .update(emailEvents)
        .set({ sentAt: now })
        .where(and(eq(emailEvents.key, row.key), isNull(emailEvents.sentAt)))
        .run();
      if (claimed.changes !== 1) continue; // another process has it
      try {
        if (deliver(db, row, now)) queued += 1;
      } catch (error) {
        log().error('A billing email could not be prepared', { kind: row.kind, err: error });
      }
    }
  } catch (error) {
    log().error('Could not dispatch billing emails; the scheduler will try again', { err: error });
  }
  return queued;
}
