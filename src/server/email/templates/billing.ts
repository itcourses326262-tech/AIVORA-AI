import 'server-only';
import { formatMoney } from '@/lib/billing/format';
import type { Locale } from '@/lib/i18n/locales';
import { getPack, getPlan } from '@/lib/billing/plans';
import { intlTag } from '@/lib/utils';
import type { BillingEmailKind, EmailMessage } from '../types';
import { emailCopy } from './copy';
import { creditsLabel, duration, paragraph, plain, type Common, type Value } from './fill';
import { renderLayout, singleLine, type Block, type DetailRow, type Paragraph } from './layout';

/**
 * The mails about money (receipt, renewal link, overdue, expired, refund, cancel, resume). Pure
 * like the rest of the templates: everything they state comes in through the spec, already
 * resolved by `server/billing/mail.ts` (item names in the recipient's language, links built from
 * APP_URL, amounts in halalas). They carry no token of ours; the one external link is the payment
 * page of a renewal.
 */

interface Billing extends Common {
  /** Absolute link to the Billing page of the account. */
  billingLink: string;
  /** The operator's support address (`SUPPORT_EMAIL`), when one is configured. */
  supportEmail?: string;
}

export type BillingEmailSpec =
  | (Billing & {
      kind: 'payment_receipt';
      /** Localized name of the pack or plan. */
      item: string;
      /** The order id: what the buyer quotes to support. */
      reference: string;
      amountHalalas: number;
      vatHalalas: number;
      credits: number;
      paidAt: number;
      /**
       * The paid month of a plan payment ends here. Absent when the payment did not start or extend
       * a month (the plan had already ended): the credits came, the plan did not.
       */
      paidUntil?: number;
      /** True for a plan's monthly payment (first month or renewal). */
      plan: boolean;
      renewal: boolean;
      /** Days before the month ends at which the payment link is emailed. */
      leadDays: number;
    })
  | (Billing & {
      kind: 'renewal_link';
      item: string;
      amountHalalas: number;
      credits: number;
      /** End of the paid month: the renewal date. */
      dueAt: number;
      /** Last moment the renewal can still be paid. */
      graceEndsAt: number;
      /** The payment page. */
      link: string;
    })
  | (Billing & {
      kind: 'payment_overdue';
      item: string;
      amountHalalas: number;
      dueAt: number;
      graceEndsAt: number;
      /** The payment page, when the renewal can still be paid there. */
      link?: string;
    })
  | (Billing & { kind: 'subscription_expired'; item: string; pricingLink: string })
  | (Billing & {
      kind: 'refund_notice';
      item: string;
      reference: string;
      /** Returned by THIS refund. */
      refundedHalalas: number;
      /** Returned so far, and the price of the order. */
      refundedTotalHalalas: number;
      orderAmountHalalas: number;
      /** Credits this refund took back (0: none, or none had been granted). */
      creditsTakenBack: number;
      /** False when the payment was returned before its credits were granted. */
      credited: boolean;
      /** The plan this payment covered has ended. */
      planEnded: boolean;
    })
  | (Billing & {
      kind: 'subscription_canceled';
      item: string;
      /** When the plan ends; absent when canceling ended it at once. */
      endsAt?: number;
    })
  | (Billing & {
      kind: 'subscription_resumed';
      item: string;
      renewsAt: number;
      leadDays: number;
    });

/** "November 8, 2026 at 10:30 AM UTC": the user's zone is not known here, so the zone is said. */
function momentText(at: number, locale: Locale): string {
  const formatted = new Intl.DateTimeFormat(intlTag(locale), {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(at);
  return `${formatted} UTC`;
}

const when = (at: number, locale: Locale): Value => ({ value: momentText(at, locale) });
const money = (halalas: number, locale: Locale): Value => ({
  value: formatMoney(halalas, locale, { fractionDigits: 2 }),
  strong: true,
});

/**
 * How a pack or plan is named inside a sentence: "Small pack" / "Pro plan" / "حزمة صغيرة" /
 * "باقة المحترف". An id that left the price list is shown as it is.
 */
export function itemLabel(itemId: string, locale: Locale): string {
  const pack = getPack(itemId);
  if (pack) return pack.name[locale];
  const plan = getPlan(itemId);
  if (plan) return plain(emailCopy[locale].billing.planLabel, { name: plan.name[locale] });
  return itemId;
}

function row(label: string, value: string, extra: Partial<DetailRow> = {}): DetailRow {
  return { label, value, ...extra };
}

export function renderBillingEmail(spec: BillingEmailSpec): EmailMessage {
  const { locale } = spec;
  const c = emailCopy[locale];
  const b = c.billing;
  const greeting = paragraph(c.shared.greeting, { name: { value: spec.name } }, locale);
  const item: Value = { value: spec.item, strong: true };
  const base = { locale, brand: c.brand, linkHint: c.shared.linkHint };
  const footer = paragraph(
    c.shared.sentTo,
    { email: { value: spec.to, ltr: true } },
    locale,
    'muted',
  );
  const support: Paragraph[] = spec.supportEmail
    ? [paragraph(b.support, { email: { value: spec.supportEmail, ltr: true } }, locale, 'muted')]
    : [];
  const kept = paragraph(b.kept, {}, locale);
  const openBilling = { label: b.openBilling, url: spec.billingLink };

  const finish = (
    kind: BillingEmailKind,
    copy: { subject: string; preheader: string; heading: string },
    paragraphs: readonly Block[],
    action: { label: string; url: string },
  ): EmailMessage => {
    const { html, text } = renderLayout({
      ...base,
      subject: copy.subject,
      preheader: copy.preheader,
      heading: copy.heading,
      paragraphs: [greeting, ...paragraphs, ...support],
      action,
      footer,
    });
    return {
      kind,
      to: spec.to,
      subject: singleLine(copy.subject),
      html,
      text,
      locale,
    };
  };

  switch (spec.kind) {
    case 'payment_receipt': {
      const rows: DetailRow[] = [
        row(
          b.receipt.labels.amount,
          formatMoney(spec.amountHalalas, locale, { fractionDigits: 2 }),
          {
            strong: true,
          },
        ),
        row(b.receipt.labels.vat, formatMoney(spec.vatHalalas, locale, { fractionDigits: 2 })),
        row(b.receipt.labels.credits, creditsLabel(locale, spec.credits)),
        row(b.receipt.labels.reference, spec.reference, { ltr: true }),
        row(b.receipt.labels.date, momentText(spec.paidAt, locale)),
      ];
      if (spec.paidUntil !== undefined) {
        rows.push(row(b.receipt.labels.paidUntil, momentText(spec.paidUntil, locale)));
      }
      const lines: Block[] = [
        paragraph(spec.renewal ? b.receipt.introRenewal : b.receipt.intro, { item }, locale),
        { rows },
      ];
      if (spec.plan) {
        // Renewal links only follow a plan that is running; a payment that arrived after the plan
        // ended must not promise them.
        lines.push(
          spec.paidUntil === undefined
            ? paragraph(b.receipt.noPlan, {}, locale)
            : paragraph(
                b.receipt.renewalNote,
                { lead: { value: duration(locale, 'day', spec.leadDays) } },
                locale,
              ),
        );
      }
      lines.push(kept, paragraph(b.notInvoice, {}, locale, 'muted'));
      return finish(
        'payment_receipt',
        {
          subject: plain(b.receipt.subject, { item: spec.item }),
          preheader: b.receipt.preheader,
          heading: b.receipt.heading,
        },
        lines,
        openBilling,
      );
    }
    case 'renewal_link': {
      const date = when(spec.dueAt, locale);
      return finish(
        'renewal_link',
        {
          subject: plain(b.renewalLink.subject, { item: spec.item }),
          preheader: plain(b.renewalLink.preheader, { date: momentText(spec.dueAt, locale) }),
          heading: b.renewalLink.heading,
        },
        [
          paragraph(
            b.renewalLink.intro,
            {
              item,
              date,
              amount: money(spec.amountHalalas, locale),
              credits: { value: creditsLabel(locale, spec.credits), strong: true },
            },
            locale,
          ),
          paragraph(b.renewalLink.unpaid, { graceEnd: when(spec.graceEndsAt, locale) }, locale),
          paragraph(b.noCharge, {}, locale),
          kept,
          paragraph(b.renewalLink.cancel, {}, locale, 'muted'),
          paragraph(
            b.renewalLink.billingHint,
            { billing: { value: spec.billingLink, ltr: true } },
            locale,
            'muted',
          ),
        ],
        { label: b.renewalLink.action, url: spec.link },
      );
    }
    case 'payment_overdue':
      return finish(
        'payment_overdue',
        {
          subject: plain(b.overdue.subject, { item: spec.item }),
          preheader: plain(b.overdue.preheader, { graceEnd: momentText(spec.graceEndsAt, locale) }),
          heading: b.overdue.heading,
        },
        [
          paragraph(
            b.overdue.intro,
            { item, date: when(spec.dueAt, locale), amount: money(spec.amountHalalas, locale) },
            locale,
          ),
          paragraph(
            b.overdue.deadline,
            { graceEnd: when(spec.graceEndsAt, locale) },
            locale,
            'warning',
          ),
          kept,
        ],
        spec.link ? { label: b.overdue.action, url: spec.link } : openBilling,
      );
    case 'subscription_expired':
      return finish(
        'subscription_expired',
        {
          subject: plain(b.expired.subject, { item: spec.item }),
          preheader: b.expired.preheader,
          heading: b.expired.heading,
        },
        [
          paragraph(b.expired.intro, { item }, locale),
          kept,
          paragraph(b.expired.again, {}, locale),
        ],
        { label: b.expired.action, url: spec.pricingLink },
      );
    case 'refund_notice': {
      const lines: Paragraph[] = [
        paragraph(
          spec.credited ? b.refund.intro : b.refund.introNoCredit,
          {
            item,
            amount: money(spec.refundedHalalas, locale),
            reference: { value: spec.reference, ltr: true },
          },
          locale,
        ),
      ];
      if (spec.creditsTakenBack > 0) {
        lines.push(
          paragraph(
            b.refund.credits,
            { credits: { value: creditsLabel(locale, spec.creditsTakenBack), strong: true } },
            locale,
          ),
        );
      }
      if (spec.refundedTotalHalalas < spec.orderAmountHalalas) {
        lines.push(
          paragraph(
            b.refund.total,
            {
              total: money(spec.refundedTotalHalalas, locale),
              price: money(spec.orderAmountHalalas, locale),
            },
            locale,
            'muted',
          ),
        );
      }
      if (spec.planEnded) lines.push(paragraph(b.refund.planEnded, {}, locale, 'warning'));
      return finish(
        'refund_notice',
        {
          subject: plain(b.refund.subject, { item: spec.item }),
          preheader: b.refund.preheader,
          heading: b.refund.heading,
        },
        lines,
        openBilling,
      );
    }
    case 'subscription_canceled': {
      const lines: Paragraph[] =
        spec.endsAt === undefined
          ? [paragraph(b.canceled.introNow, { item }, locale), kept]
          : [
              paragraph(b.canceled.introEnd, { item, date: when(spec.endsAt, locale) }, locale),
              kept,
              paragraph(b.canceled.resume, { date: when(spec.endsAt, locale) }, locale, 'muted'),
            ];
      return finish(
        'subscription_canceled',
        {
          subject: plain(b.canceled.subject, { item: spec.item }),
          preheader: b.canceled.preheader,
          heading: b.canceled.heading,
        },
        lines,
        openBilling,
      );
    }
    case 'subscription_resumed':
      return finish(
        'subscription_resumed',
        {
          subject: plain(b.resumed.subject, { item: spec.item }),
          preheader: b.resumed.preheader,
          heading: b.resumed.heading,
        },
        [
          paragraph(b.resumed.intro, { item, date: when(spec.renewsAt, locale) }, locale),
          paragraph(
            b.resumed.link,
            { lead: { value: duration(locale, 'day', spec.leadDays) } },
            locale,
          ),
          paragraph(b.noCharge, {}, locale),
        ],
        openBilling,
      );
  }
}
