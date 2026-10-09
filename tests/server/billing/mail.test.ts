import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { RENEWAL_GRACE_MS, RENEWAL_LEAD_MS, addMonthsUtc } from '@/lib/billing/period';
import { dispatchBillingMail, recordReceipt } from '@/server/billing/mail';
import { createCheckout } from '@/server/billing/orders';
import { refundOrder } from '@/server/billing/refunds';
import { tick } from '@/server/billing/scheduler';
import { settleOrder } from '@/server/billing/settle';
import {
  cancelSubscription,
  currentSubscription,
  resumeSubscription,
} from '@/server/billing/subscriptions';
import { handleWebhook } from '@/server/billing/webhooks';
import { withTx } from '@/server/db';
import {
  emailEvents,
  orders,
  subscriptions,
  users,
  type EmailEventRow,
  type UserRow,
} from '@/server/db/schema';
import {
  flushEmails,
  getOutbox,
  setEmailTransportOverride,
  type OutboxEntry,
} from '@/server/email';
import type { EmailKind } from '@/server/email/types';
import { cleanEmailState } from '../email/support';
import { billingTest } from './support';

const t = billingTest();
cleanEmailState();

const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
const END1 = addMonthsUtc(T0, 1, 8);
const DAY_AFTER = 24 * 60 * 60 * 1000;

const NO_BREAK_SPACE = String.fromCodePoint(0xa0);
const unbreak = (value: string | undefined) => value?.replaceAll(NO_BREAK_SPACE, ' ');

/**
 * Everything that was delivered so far, optionally only one kind (and only to one account). Intl
 * puts a no-break space between "SAR" and the number; the tests read it as a plain space.
 */
async function delivered(kind?: EmailKind, user?: UserRow): Promise<OutboxEntry[]> {
  await flushEmails();
  return getOutbox()
    .filter(
      (entry) =>
        entry.status === 'sent' &&
        (kind === undefined || entry.kind === kind) &&
        (user === undefined || entry.to === user.email),
    )
    .map((entry) => ({
      ...entry,
      subject: unbreak(entry.subject) ?? '',
      text: unbreak(entry.text),
      html: unbreak(entry.html),
    }));
}

const events = (): EmailEventRow[] => t.db.select().from(emailEvents).all();
const english = (overrides: Partial<UserRow> = {}) => t.newUser({ locale: 'en', ...overrides });

async function paidPack(user: UserRow, id = 'pack-500', now = T0) {
  const { order } = await createCheckout(
    user.id,
    { type: 'pack', id },
    { idempotencyKey: `k-${id}-${Math.random()}`, now },
  );
  t.moyasar.pay(order.id);
  await settleOrder(order.id, { now });
  return order;
}

/** Subscribes to `pro` at T0 and pays the first month. */
async function subscribed(user: UserRow, plan = 'pro') {
  const { order } = await createCheckout(
    user.id,
    { type: 'subscription', id: plan },
    { idempotencyKey: `k-${plan}`, now: T0 },
  );
  t.moyasar.pay(order.id);
  await settleOrder(order.id, { now: T0 });
  return order;
}

const renewalOf = (userId: string) =>
  t.db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .all()
    .find((order) => order.kind === 'subscription_renewal');

describe('the receipt', () => {
  it('goes out once after a pack is paid, with the amount, VAT, credits, reference and billing link', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-1500');

    const [receipt, ...more] = await delivered('payment_receipt', user);
    expect(more).toEqual([]);
    expect(receipt?.subject).toBe('Payment received: Medium pack');
    for (const body of [receipt?.text, receipt?.html]) {
      expect(body).toContain('SAR 79.00');
      expect(body).toContain('SAR 10.30');
      expect(body).toContain('1,500 credits');
      expect(body).toContain(order.id);
      expect(body).toContain('http://localhost:3000/account/billing');
    }
    expect(receipt?.text).not.toContain('Plan paid until');
    expect(events()).toMatchObject([
      { key: `receipt:${order.id}`, kind: 'payment_receipt', subject: order.id },
    ]);
    expect(events()[0]?.sentAt).not.toBeNull();
  });

  it('is sent once however often the payment is announced: replays, repeated checks, parallel settles', async () => {
    const user = english();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k', now: T0 },
    );
    t.moyasar.pay(order.id);

    await Promise.all([1, 2, 3, 4, 5].map(() => settleOrder(order.id, { now: T0 })));
    const hook = t.moyasar.webhook('payment_paid', order.id, { eventId: 'evt_1' });
    await handleWebhook(hook, T0);
    await handleWebhook(hook, T0); // the very same delivery again
    await handleWebhook(t.moyasar.webhook('payment_paid', order.id, { eventId: 'evt_2' }), T0);
    await settleOrder(order.id, { now: T0 + 60_000 });

    expect(t.balance(user.id)).toBe(500);
    expect(await delivered('payment_receipt', user)).toHaveLength(1);
    expect(events()).toHaveLength(1);
  });

  it('names the month a plan payment covers, and says it is the monthly payment on a renewal', async () => {
    const user = english();
    const first = await subscribed(user);
    const [initial] = await delivered('payment_receipt', user);
    expect(initial?.subject).toBe('Payment received: Pro plan');
    expect(initial?.text).toContain('Plan paid until: November 8, 2026 at 10:00 AM UTC');
    expect(initial?.text).toContain('We received your payment for Pro plan');
    expect(initial?.text).toContain('We email you the payment link 3 days before the month ends.');

    await tick(END1 - RENEWAL_LEAD_MS);
    const renewal = renewalOf(user.id);
    expect(renewal).toBeDefined();
    t.moyasar.pay(renewal?.id ?? '');
    await settleOrder(renewal?.id ?? '', { now: END1 - 1000 });

    const receipts = await delivered('payment_receipt', user);
    expect(receipts).toHaveLength(2);
    expect(receipts[1]?.text).toContain('the monthly payment for your Pro plan');
    expect(receipts[1]?.text).toContain('December 8, 2026');
    expect(first.id).not.toBe(renewal?.id);
  });

  it('does not promise renewal links for a plan that is not running: the first month was credited after the plan had ended', async () => {
    const user = english();
    const { order } = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'k-late-first', now: T0 },
    );
    // The payment was parked and credited late; meanwhile the subscription had been ended.
    t.db
      .update(subscriptions)
      .set({ status: 'canceled' })
      .where(eq(subscriptions.userId, user.id))
      .run();
    t.moyasar.pay(order.id);
    await settleOrder(order.id, { now: T0 });

    expect(t.balance(user.id)).toBeGreaterThan(0);
    expect(
      t.db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).get(),
    ).toMatchObject({
      status: 'canceled',
    });
    const [receipt, ...more] = await delivered('payment_receipt', user);
    expect(more).toEqual([]);
    for (const body of [receipt?.text ?? '', receipt?.html ?? '']) {
      expect(body).not.toContain('Plan paid until');
      expect(body).not.toContain('Your plan renews every month');
      expect(body).not.toContain('We email you the payment link');
      expect(body).toContain('did not start a new month of your plan');
    }
  });

  it('says the same for a renewal paid after the plan expired, and still names the credits that came', async () => {
    const user = english();
    await subscribed(user);
    await tick(END1 - RENEWAL_LEAD_MS);
    const renewal = renewalOf(user.id);
    expect(renewal).toBeDefined();
    t.db
      .update(subscriptions)
      .set({ status: 'expired', nextChargeAt: null })
      .where(eq(subscriptions.userId, user.id))
      .run();
    t.moyasar.pay(renewal?.id ?? '');
    await settleOrder(renewal?.id ?? '', { now: END1 - 1000 });

    const receipts = await delivered('payment_receipt', user);
    expect(receipts).toHaveLength(2);
    expect(receipts[1]?.text).toContain('the monthly payment for your Pro plan');
    expect(receipts[1]?.text).toContain('Credits added: 3,000 credits');
    expect(receipts[1]?.text).not.toContain('Plan paid until');
    expect(receipts[1]?.text).toContain('did not start a new month of your plan');
    expect(receipts[1]?.text).not.toContain('Your plan renews every month');
  });

  it('is in the language of the account and right to left in Arabic', async () => {
    const user = t.newUser({ locale: 'ar' });
    await paidPack(user, 'pack-500');
    const [receipt] = await delivered('payment_receipt', user);
    expect(receipt?.subject).toBe('تم استلام دفعتك: حزمة صغيرة');
    expect(receipt?.html).toContain('<html lang="ar" dir="rtl">');
    expect(receipt?.html).toContain('٥٠٠ رصيد');
    expect(receipt?.html).toContain('٢٩٫٠٠');
  });

  it('follows the language the account has when the message is sent, not when it was recorded', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-500');
    t.db.update(emailEvents).set({ sentAt: null }).where(eq(emailEvents.subject, order.id)).run();
    t.db.update(users).set({ locale: 'ar' }).where(eq(users.id, user.id)).run();
    dispatchBillingMail();
    const receipts = await delivered('payment_receipt', user);
    expect(receipts).toHaveLength(2);
    expect(receipts[0]?.subject).toBe('Payment received: Small pack');
    expect(receipts[1]?.subject).toBe('تم استلام دفعتك: حزمة صغيرة');
  });

  it('reaches an account that has not confirmed its address, and never carries a token or a verification link', async () => {
    process.env.EMAIL_VERIFICATION = 'required';
    try {
      const user = english({ emailVerifiedAt: null });
      await paidPack(user, 'pack-500');
      const [receipt] = await delivered('payment_receipt', user);
      expect(receipt).toBeDefined();
      for (const body of [receipt?.text ?? '', receipt?.html ?? '']) {
        expect(body).not.toMatch(/token=|\/verify-email|\/reset-password|\/forgot-password/);
      }
    } finally {
      delete process.env.EMAIL_VERIFICATION;
    }
  });

  it('is not sent to an account that was deleted meanwhile', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-500');
    t.db.update(emailEvents).set({ sentAt: null }).where(eq(emailEvents.subject, order.id)).run();
    const before = (await delivered()).length;
    t.db.update(users).set({ deletedAt: T0 }).where(eq(users.id, user.id)).run();
    expect(dispatchBillingMail()).toBe(0);
    expect(await delivered()).toHaveLength(before);
    // The row is spent: it is not tried again either.
    expect(events()[0]?.sentAt).not.toBeNull();
  });

  it('puts the support address in when the operator configured one, and says nothing about it when not', async () => {
    vi.stubEnv('SUPPORT_EMAIL', 'help@aivore.example');
    const user = english();
    await paidPack(user, 'pack-500');
    const [withSupport] = await delivered('payment_receipt', user);
    expect(withSupport?.text).toContain('help@aivore.example');

    vi.stubEnv('SUPPORT_EMAIL', '');
    const other = english();
    await paidPack(other, 'pack-500');
    const [without] = await delivered('payment_receipt', other);
    expect(without?.text).not.toContain('Questions about a payment');
  });
});

describe('what a broken mail setup may and may not do', () => {
  it('a relay that is down changes nothing about the payment: credited, order paid, nothing thrown', async () => {
    setEmailTransportOverride({
      name: 'smtp',
      send: () => Promise.reject(new Error('relay down')),
    });
    const user = english();
    const order = await paidPack(user, 'pack-500');
    await flushEmails();

    expect(t.order(order.id).status).toBe('paid');
    expect(t.balance(user.id)).toBe(500);
    expect(getOutbox().filter((entry) => entry.status === 'failed')).toHaveLength(1);
    // Delivery is at most once: the row is claimed and a failed relay does not make it resend.
    expect(events()[0]?.sentAt).not.toBeNull();
    setEmailTransportOverride(null);
    dispatchBillingMail();
    expect(await delivered('payment_receipt', user)).toHaveLength(0);
  });

  it('a mail table that cannot be written to changes nothing about the payment either', async () => {
    t.db.$client.exec('DROP TABLE email_events');
    const user = english();
    const order = await paidPack(user, 'pack-500');
    expect(t.order(order.id).status).toBe('paid');
    expect(t.balance(user.id)).toBe(500);
    expect(dispatchBillingMail()).toBe(0);
  });
});

describe('the renewal link and the reminders', () => {
  it('mails the payment link 3 days before the month ends, once, with the amount, the dates and what happens if unpaid', async () => {
    const user = english();
    await subscribed(user);
    expect(await delivered('renewal_link', user)).toHaveLength(0);

    await tick(END1 - RENEWAL_LEAD_MS - 1);
    expect(await delivered('renewal_link', user)).toHaveLength(0);

    await tick(END1 - RENEWAL_LEAD_MS);
    const renewal = renewalOf(user.id);
    expect(renewal?.checkoutUrl).toBeTruthy();
    const [mail, ...more] = await delivered('renewal_link', user);
    expect(more).toEqual([]);
    expect(mail?.subject).toBe('Your Pro plan renewal is ready to pay');
    for (const body of [mail?.text ?? '', mail?.html ?? '']) {
      expect(body).toContain(renewal?.checkoutUrl);
      expect(body).toContain('SAR 139.00');
      expect(body).toContain('3,000 credits');
      expect(body).toContain('November 8, 2026');
      expect(body).toContain('November 15, 2026');
    }
    expect(mail?.text).toContain('your plan becomes overdue');
    expect(mail?.text).toContain('the plan expires');
    expect(mail?.text).toContain('We never charge your card automatically.');

    // Later ticks (a restarted scheduler, another process) add nothing.
    await tick(END1 - RENEWAL_LEAD_MS + 30_000);
    await tick(END1 - 60_000);
    await tick(END1 - RENEWAL_LEAD_MS);
    expect(await delivered('renewal_link', user)).toHaveLength(1);
    expect(events().filter((event) => event.kind === 'renewal_link')).toHaveLength(1);
  });

  it('mails a replacement link, once, when the first one was withdrawn at the gateway', async () => {
    const user = english();
    await subscribed(user);
    await tick(END1 - RENEWAL_LEAD_MS);
    const first = renewalOf(user.id);
    t.moyasar.expire(first?.id ?? '');
    await settleOrder(first?.id ?? '', { now: END1 - RENEWAL_LEAD_MS + 1000 });
    await tick(END1 - RENEWAL_LEAD_MS + 2000);
    await tick(END1 - RENEWAL_LEAD_MS + 3000);

    const links = await delivered('renewal_link', user);
    expect(links).toHaveLength(2);
    expect(links[0]?.text).not.toBe(links[1]?.text);
  });

  it('reminds once when the month ends unpaid and the plan turns overdue, with the link and the last day', async () => {
    const user = english();
    await subscribed(user);
    await tick(END1 - RENEWAL_LEAD_MS);
    const renewal = renewalOf(user.id);
    await tick(END1);
    expect(currentSubscription(user.id, END1)?.status).toBe('past_due');

    const [mail, ...more] = await delivered('payment_overdue', user);
    expect(more).toEqual([]);
    expect(mail?.subject).toBe('Payment overdue: your Pro plan');
    expect(mail?.text).toContain(renewal?.checkoutUrl);
    expect(mail?.text).toContain('November 8, 2026');
    expect(mail?.text).toContain('November 15, 2026');

    await tick(END1 + 60_000);
    await tick(END1);
    await tick(END1 + RENEWAL_GRACE_MS - 1);
    expect(await delivered('payment_overdue', user)).toHaveLength(1);
  });

  it('tells the user once when the grace period ends unpaid and the plan expires, and that credits stay', async () => {
    const user = english();
    await subscribed(user);
    await tick(END1 - RENEWAL_LEAD_MS);
    await tick(END1);
    expect(await delivered('subscription_expired', user)).toHaveLength(0);

    await tick(END1 + RENEWAL_GRACE_MS);
    const [mail, ...more] = await delivered('subscription_expired', user);
    expect(more).toEqual([]);
    expect(mail?.subject).toBe('Your Pro plan has ended');
    expect(mail?.text).toContain('stay in your balance and never expire');
    expect(mail?.text).toContain('http://localhost:3000/pricing');
    expect(currentSubscription(user.id, END1 + RENEWAL_GRACE_MS)?.status).toBe('expired');

    await tick(END1 + RENEWAL_GRACE_MS + 60_000);
    await tick(END1 + RENEWAL_GRACE_MS + DAY_AFTER);
    expect(await delivered('subscription_expired', user)).toHaveLength(1);
    // The whole story is five messages for the buyer: receipt, link, reminder, expiry and nothing else.
    expect((await delivered(undefined, user)).map((entry) => entry.kind)).toEqual([
      'payment_receipt',
      'renewal_link',
      'payment_overdue',
      'subscription_expired',
    ]);
  });

  it('sends a replacement link issued while the plan is overdue as the overdue notice with the new link, not as "renews on a past date"', async () => {
    const user = english();
    await subscribed(user);
    await tick(END1 - RENEWAL_LEAD_MS);
    const first = renewalOf(user.id);
    await tick(END1);
    // The payment page is closed at the gateway while the plan is overdue: the scheduler replaces it.
    t.moyasar.expire(first?.id ?? '');
    await settleOrder(first?.id ?? '', { now: END1 + 1000 });
    await tick(END1 + 2000);

    const second = t.db
      .select()
      .from(orders)
      .where(eq(orders.userId, user.id))
      .all()
      .find((order) => order.kind === 'subscription_renewal' && order.status === 'pending');
    expect(second?.id).not.toBe(first?.id);
    const mails = await delivered(undefined, user);
    expect(mails.map((mail) => mail.kind)).toEqual([
      'payment_receipt',
      'renewal_link',
      'payment_overdue',
      'payment_overdue',
    ]);
    const replacement = mails[3];
    expect(replacement?.text).toContain(second?.checkoutUrl);
    expect(replacement?.text).toContain('has not been paid yet');
    expect(replacement?.text).not.toContain('renews on');
  });

  it('does not send a reminder for a link that was paid before the message went out', async () => {
    const user = english();
    await subscribed(user);
    await tick(END1 - RENEWAL_LEAD_MS);
    const renewal = renewalOf(user.id);
    const linkMails = (await delivered('renewal_link', user)).length;
    // The mail is recorded again as if its process had died before sending, and the link gets paid.
    t.db
      .update(emailEvents)
      .set({ sentAt: null })
      .where(eq(emailEvents.kind, 'renewal_link'))
      .run();
    t.moyasar.pay(renewal?.id ?? '');
    await settleOrder(renewal?.id ?? '', { now: END1 - 1000 });
    dispatchBillingMail();
    expect(await delivered('renewal_link', user)).toHaveLength(linkMails);
  });
});

describe('refunds and chargebacks', () => {
  it('tells the buyer once when a payment is returned in full: the amount, the credits taken back, the order', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-500');
    await refundOrder(order.id);

    const [mail, ...more] = await delivered('refund_notice', user);
    expect(more).toEqual([]);
    expect(mail?.subject).toBe('Refund for Small pack');
    expect(mail?.text).toContain('SAR 29.00');
    expect(mail?.text).toContain(order.id);
    expect(mail?.text).toContain('500 credits were taken back from your balance.');
    expect(mail?.text).not.toContain('Returned so far');
    expect(t.balance(user.id)).toBe(0);

    // The gateway announcing it again, the re-check of paid orders, a second look: still one.
    await handleWebhook(t.moyasar.webhook('payment_refunded', order.id, { eventId: 'r1' }), T0);
    await handleWebhook(t.moyasar.webhook('payment_refunded', order.id, { eventId: 'r2' }), T0);
    await settleOrder(order.id);
    await settleOrder(order.id);
    expect(await delivered('refund_notice', user)).toHaveLength(1);
  });

  it('sends one notice per refunded total: two partial refunds are two messages, each with the total so far', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-1500');
    await refundOrder(order.id, { amountHalalas: 1_975 });
    await refundOrder(order.id, { amountHalalas: 1_975 });
    await settleOrder(order.id);

    const [first, second, ...more] = await delivered('refund_notice', user);
    expect(more).toEqual([]);
    expect(first?.text).toContain('SAR 19.75');
    expect(first?.text).toContain('375 credits were taken back');
    expect(first?.text).toContain('Returned so far: SAR 19.75 of SAR 79.00.');
    expect(second?.text).toContain('Returned so far: SAR 39.50 of SAR 79.00.');
    expect(
      events()
        .filter((event) => event.kind === 'refund_notice')
        .map((e) => e.key),
    ).toEqual([`refund:${order.id}:1975`, `refund:${order.id}:3950`]);
  });

  it('keeps the review queue to the operator: a refund that found the credits spent says how many were taken, nothing else', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-500');
    t.db.update(users).set({ creditBalance: 10 }).where(eq(users.id, user.id)).run();
    await refundOrder(order.id);

    expect(t.order(order.id)).toMatchObject({ status: 'needs_review', clawedBackCredits: 10 });
    const [mail] = await delivered('refund_notice', user);
    expect(mail?.text).toContain('10 credits were taken back from your balance.');
    for (const body of [mail?.subject, mail?.text, mail?.html]) {
      expect(body).not.toMatch(/review|shortfall|spent|needs_review/i);
    }
  });

  it('says no credits were added when the payment was returned before they were granted', async () => {
    const user = english();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k', now: T0 },
    );
    t.moyasar.pay(order.id);
    t.moyasar.refundOutside(order.id);
    await settleOrder(order.id, { now: T0 });

    expect(t.order(order.id).status).toBe('refunded');
    expect(t.balance(user.id)).toBe(0);
    expect(await delivered('payment_receipt', user)).toHaveLength(0);
    const [mail, ...more] = await delivered('refund_notice', user);
    expect(more).toEqual([]);
    expect(mail?.text).toContain('before any credits were added');
    expect(mail?.text).not.toContain('were taken back');
  });

  it('says the plan ended when the refunded payment was the one that funded the running month', async () => {
    const user = english();
    const order = await subscribed(user);
    await refundOrder(order.id);
    const [mail] = await delivered('refund_notice', user);
    expect(mail?.text).toContain('The plan that this payment covered has ended.');
    expect(mail?.text).toContain('3,000 credits were taken back');
  });
});

describe('canceling and resuming a plan', () => {
  it('confirms each real change once, and a repeated request says nothing more', async () => {
    const user = english();
    await subscribed(user);

    await cancelSubscription(user.id, T0 + 1000);
    await cancelSubscription(user.id, T0 + 2000);
    await cancelSubscription(user.id, T0 + 3000);
    let canceled = await delivered('subscription_canceled', user);
    expect(canceled).toHaveLength(1);
    expect(canceled[0]?.subject).toBe('Your Pro plan is canceled');
    expect(canceled[0]?.text).toContain('ends on November 8, 2026');
    expect(canceled[0]?.text).toContain('stays fully active until then');
    expect(canceled[0]?.text).toContain('You can resume the plan in Billing until');

    resumeSubscription(user.id, T0 + 4000);
    // Already running: nothing changes, nothing is said.
    expect(resumeSubscription(user.id, T0 + 5000).cancelAtPeriodEnd).toBe(false);
    const resumed = await delivered('subscription_resumed', user);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.text).toContain('will renew as usual on November 8, 2026');
    expect(resumed[0]?.text).toContain(
      'We email you the payment link 3 days before the month ends.',
    );

    // Changing one's mind again is a new change, with its own confirmation.
    await cancelSubscription(user.id, T0 + 6000);
    canceled = await delivered('subscription_canceled', user);
    expect(canceled).toHaveLength(2);
    expect(events().map((event) => event.key)).toEqual(
      expect.arrayContaining([
        `subscription_canceled:${currentSubscription(user.id, T0)?.id}:1`,
        `subscription_canceled:${currentSubscription(user.id, T0)?.id}:2`,
        `subscription_resumed:${currentSubscription(user.id, T0)?.id}:1`,
      ]),
    );
  });

  it('says the plan ended at once when it was overdue, and offers no resume', async () => {
    const user = english();
    await subscribed(user);
    await tick(END1 - RENEWAL_LEAD_MS);
    await tick(END1);
    await cancelSubscription(user.id, END1 + 1000);

    const [mail, ...more] = await delivered('subscription_canceled', user);
    expect(more).toEqual([]);
    expect(mail?.text).toContain('was overdue, so canceling ended it right away');
    expect(mail?.text).not.toContain('resume the plan');
  });

  it('stays quiet about an unpaid first month that is abandoned', async () => {
    const user = english();
    await createCheckout(
      user.id,
      { type: 'subscription', id: 'starter' },
      { idempotencyKey: 'k', now: T0 },
    );
    await cancelSubscription(user.id, T0 + 1000);
    expect(await delivered(undefined, user)).toEqual([]);
    expect(events()).toEqual([]);
  });
});

describe('what a process that died leaves behind', () => {
  it('is sent by the next scheduler tick, once, however many ticks follow', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-500');
    // Back to the state of a process that committed the payment and died before it could send.
    t.db.delete(emailEvents).run();
    withTx(t.db, (tx) => recordReceipt(tx, t.order(order.id), T0, undefined));
    expect(events()[0]?.sentAt).toBeNull();
    const before = (await delivered('payment_receipt', user)).length;

    await tick(T0 + 60_000);
    await tick(T0 + 120_000);
    await tick(T0 + 180_000);

    expect(await delivered('payment_receipt', user)).toHaveLength(before + 1);
    expect(events()[0]?.sentAt).not.toBeNull();
  });

  it('is not sent twice by dispatchers that run one after the other or together', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-500');
    t.db.update(emailEvents).set({ sentAt: null }).where(eq(emailEvents.subject, order.id)).run();
    const before = (await delivered('payment_receipt', user)).length;

    const counts = [1, 2, 3, 4, 5].map(() => dispatchBillingMail());
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await delivered('payment_receipt', user)).toHaveLength(before + 1);
  });

  it('is not sent at all once another process claimed it (that process owns the delivery)', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-500');
    const before = (await delivered('payment_receipt', user)).length;
    t.db.update(emailEvents).set({ sentAt: T0 }).where(eq(emailEvents.subject, order.id)).run();
    expect(dispatchBillingMail()).toBe(0);
    expect(await delivered('payment_receipt', user)).toHaveLength(before);
  });

  it('drops a row whose facts cannot be read, loudly and without taking the others down', async () => {
    const user = english();
    t.db
      .insert(emailEvents)
      .values({
        key: 'receipt:broken',
        userId: user.id,
        kind: 'payment_receipt',
        subject: 'ord_broken',
        payload: '{"kind":"payment_receipt"}',
        createdAt: T0,
      })
      .run();
    await paidPack(user, 'pack-500');
    expect(await delivered('payment_receipt', user)).toHaveLength(1);
    expect(events().every((event) => event.sentAt !== null)).toBe(true);
  });
});

describe('the dedupe record', () => {
  it('has one row per change and survives a second record of the same change', async () => {
    const user = english();
    const order = await paidPack(user, 'pack-500');
    withTx(t.db, (tx) => {
      recordReceipt(tx, t.order(order.id), T0 + 5, undefined);
      recordReceipt(tx, t.order(order.id), T0 + 9, undefined);
    });
    expect(events()).toHaveLength(1);
    expect(events()[0]?.createdAt).toBe(T0);
  });

  it('is written in the transaction of the change: a change that rolls back leaves no mail behind', async () => {
    const user = english();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k', now: T0 },
    );
    expect(() =>
      withTx(t.db, (tx) => {
        recordReceipt(tx, t.order(order.id), T0, undefined);
        throw new Error('the change failed after the record');
      }),
    ).toThrow();
    expect(events()).toEqual([]);
  });
});
