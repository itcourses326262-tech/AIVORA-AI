import { describe, expect, it } from 'vitest';
import { renderEmail } from '@/server/email';
import { BILLING_EMAIL_KINDS } from '@/server/email/types';
import { itemLabel } from '@/server/email/templates/billing';
import { BILLING_LINK, PAY_LINK, PRICING_LINK, billingSpec } from './billing-fixtures';

const NO_BREAK_SPACE = String.fromCodePoint(0xa0);
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const read = (value: string) => value.replaceAll(NO_BREAK_SPACE, ' ').replace(/\p{Cf}/gu, '');

describe.each(['en', 'ar'] as const)('billing emails, %s', (locale) => {
  it.each(BILLING_EMAIL_KINDS)('renders %s completely', (kind) => {
    const message = renderEmail(billingSpec(kind, locale));
    expect(message).toMatchObject({ kind, to: 'layla@example.com', locale });
    expect(message.subject.trim()).not.toBe('');
    expect(message.subject).not.toMatch(/[\r\n]/);
    for (const body of [message.subject, message.html, message.text]) {
      expect(body, 'unfilled placeholder').not.toMatch(/\{\w+\}/);
    }
    expect(message.html.startsWith('<!doctype html>')).toBe(true);
    expect(message.text).not.toMatch(/<\/?(?:html|body|table|tr|td|p|div|span|a|style|h1)\b/i);
  });

  it.each(BILLING_EMAIL_KINDS)(
    'escapes every value of %s, in the name, the address and the links',
    (kind) => {
      const hostile = renderEmail(
        billingSpec(kind, locale, {
          name: '<img src=x onerror=alert(1)>',
          item: '<script>alert(1)</script>',
          reference: 'ord_"><svg onload=alert(1)>',
          supportEmail: 'a"><b>@example.com',
        }),
      );
      expect(hostile.html).not.toMatch(/<(?:img|script|svg|b)\b/i);
      expect(hostile.html).not.toContain('onerror=alert(1)>');
      // The plain text is not markup: the characters stay as the account wrote them.
      expect(hostile.subject).not.toMatch(/[\r\n]/);
    },
  );

  it.each(BILLING_EMAIL_KINDS)('%s loads nothing from the network and carries no token', (kind) => {
    const { html, text } = renderEmail(billingSpec(kind, locale));
    expect(html).not.toMatch(/<img|<script|<link|<iframe|<video|@import|@font-face|url\(|\ssrc=/i);
    const urls = [...html.matchAll(/https?:\/\/[^"'\s<)]+/g)].map((match) => match[0]);
    const allowed = [BILLING_LINK, PAY_LINK, PRICING_LINK];
    expect(urls.every((url) => allowed.includes(url))).toBe(true);
    expect(`${html}${text}`).not.toMatch(/token=|\/verify-email|\/reset-password/);
  });

  it('refuses a payment link that is not http(s)', () => {
    expect(() =>
      renderEmail(billingSpec('renewal_link', locale, { link: 'javascript:alert(1)' })),
    ).toThrow(/http/);
  });
});

const withoutFacts = (html: string) =>
  html.replace(/<table[^>]*class="rule"[^>]*>[\s\S]*?<\/table>/, '');

describe('direction', () => {
  it.each(BILLING_EMAIL_KINDS)(
    '%s is right to left in Arabic throughout and left to right in English',
    (kind) => {
      const ar = renderEmail(billingSpec(kind, 'ar')).html;
      expect(ar).toContain('<html lang="ar" dir="rtl">');
      expect(ar).toContain('<body class="page" dir="rtl"');
      expect(ar.match(/<table[^>]*dir="rtl"/g)?.length).toBeGreaterThanOrEqual(3);
      expect(ar).toContain('text-align:right');
      // Only the value cells of a facts table sit on the other side: the end of a row.
      expect(withoutFacts(ar)).not.toContain('text-align:left');
      const en = renderEmail(billingSpec(kind, 'en')).html;
      expect(en).toContain('<html lang="en" dir="ltr">');
      expect(withoutFacts(en)).not.toContain('text-align:right');
    },
  );

  it('puts the facts table of the receipt in the reading order of Arabic: label at the start, value at the end', () => {
    const { html } = renderEmail(billingSpec('payment_receipt', 'ar'));
    const table = /<table[^>]*class="rule"[^>]*>[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
    expect(table).toContain('dir="rtl"');
    // The label cell is right aligned (the start in RTL), the value cell left aligned (the end).
    expect(table).toMatch(/<td class="muted rule"[^>]*text-align:right/);
    expect(table).toMatch(/<td class="text rule"[^>]*text-align:left/);
    // The order reference is a Latin run: isolated, so it cannot reorder the row.
    expect(table).toMatch(/<span dir="ltr"[^>]*>ord_01k8m3v2h5j8k1m4n7p0q3r6st<\/span>/);
  });

  it('isolates Latin values inside Arabic plain text and not inside English', () => {
    const ar = renderEmail(billingSpec('refund_notice', 'ar')).text;
    expect(ar).toContain(`${LRI}ord_01k8m3v2h5j8k1m4n7p0q3r6st${PDI}`);
    expect(renderEmail(billingSpec('refund_notice', 'en')).text).not.toContain(LRI);
  });
});

describe('what each message says', () => {
  it('the receipt: amount with VAT, the VAT, credits, reference, date, the paid month, link to billing', () => {
    const en = read(renderEmail(billingSpec('payment_receipt', 'en')).text);
    expect(en).toContain('Amount paid (VAT included): SAR 139.00');
    expect(en).toContain('Of which VAT: SAR 18.13');
    expect(en).toContain('Credits added: 3,000 credits');
    expect(en).toContain('Order reference: ord_01k8m3v2h5j8k1m4n7p0q3r6st');
    expect(en).toContain('Date: October 8, 2026 at 10:30 AM UTC');
    expect(en).toContain('Plan paid until: November 8, 2026 at 10:30 AM UTC');
    expect(en).toContain(BILLING_LINK);
    expect(en).toContain('It is not a tax invoice.');
    const ar = read(renderEmail(billingSpec('payment_receipt', 'ar')).text);
    expect(ar).toContain('المبلغ المدفوع (شامل الضريبة): ١٣٩٫٠٠ ر.س.');
    expect(ar).toContain('الأرصدة المضافة: ٣٬٠٠٠ رصيد');
    expect(ar).toContain('وليست فاتورة ضريبية');
  });

  it('the receipt of a pack has no plan lines, the receipt of a renewal says it is the monthly payment', () => {
    const pack = read(
      renderEmail(
        billingSpec('payment_receipt', 'en', {
          plan: false,
          paidUntil: undefined,
          item: 'Small pack',
        }),
      ).text,
    );
    expect(pack).not.toContain('Plan paid until');
    expect(pack).not.toContain('payment link');
    const renewal = read(renderEmail(billingSpec('payment_receipt', 'en', { renewal: true })).text);
    expect(renewal).toContain('the monthly payment for your Pro plan');
  });

  it('the receipt of a plan payment that started no month does not promise renewal links', () => {
    for (const renewal of [false, true]) {
      const en = read(
        renderEmail(billingSpec('payment_receipt', 'en', { paidUntil: undefined, renewal })).text,
      );
      expect(en).not.toContain('Plan paid until');
      expect(en).not.toContain('Your plan renews every month');
      expect(en).not.toContain('payment link');
      expect(en).toContain('did not start a new month of your plan');
      expect(en).toContain('The credits are in your balance');
      const ar = read(
        renderEmail(billingSpec('payment_receipt', 'ar', { paidUntil: undefined, renewal })).text,
      );
      expect(ar).not.toContain('الباقة مدفوعة حتى');
      expect(ar).not.toContain('تتجدد باقتك كل شهر');
      expect(ar).toContain('لم تبدأ هذه الدفعة شهرًا جديدًا من باقتك');
    }
    // A plan that is running still gets the promise it can keep.
    expect(read(renderEmail(billingSpec('payment_receipt', 'en')).text)).toContain(
      'Your plan renews every month',
    );
  });

  it('the renewal link: the amount, the credits, the renewal date, the last day and the consequences', () => {
    const text = read(renderEmail(billingSpec('renewal_link', 'en')).text);
    expect(text).toContain('Your Pro plan renews on November 8, 2026 at 10:30 AM UTC');
    expect(text).toContain('SAR 139.00 with VAT included, for 3,000 credits');
    expect(text).toContain('your plan becomes overdue');
    expect(text).toContain('until November 15, 2026 at 10:30 AM UTC');
    expect(text).toContain('the plan expires and no more monthly credits are added');
    expect(text).toContain(`Pay now:\n${PAY_LINK}`);
  });

  it('the overdue reminder points to the link when there is one and to billing when there is not', () => {
    expect(renderEmail(billingSpec('payment_overdue', 'en')).text).toContain(
      `Pay now:\n${PAY_LINK}`,
    );
    const noLink = renderEmail(billingSpec('payment_overdue', 'en', { link: undefined })).text;
    expect(noLink).toContain(`Open billing:\n${BILLING_LINK}`);
    expect(noLink).not.toContain(PAY_LINK);
  });

  it('the refund notice in its variants: full, partial with the total, no credits, plan ended', () => {
    const full = read(renderEmail(billingSpec('refund_notice', 'en')).text);
    expect(full).toContain('SAR 139.00 of your payment for Pro plan');
    expect(full).toContain('3,000 credits were taken back from your balance.');
    expect(full).not.toContain('Returned so far');
    expect(full).toContain('The plan that this payment covered has ended.');

    const partial = read(
      renderEmail(
        billingSpec('refund_notice', 'en', {
          refundedHalalas: 3_475,
          refundedTotalHalalas: 3_475,
          creditsTakenBack: 750,
          planEnded: false,
        }),
      ).text,
    );
    expect(partial).toContain('Returned so far: SAR 34.75 of SAR 139.00.');
    expect(partial).not.toContain('has ended');

    const noCredit = read(
      renderEmail(
        billingSpec('refund_notice', 'en', {
          credited: false,
          creditsTakenBack: 0,
          planEnded: false,
        }),
      ).text,
    );
    expect(noCredit).toContain('before any credits were added');
    expect(noCredit).not.toContain('taken back');

    const none = read(
      renderEmail(billingSpec('refund_notice', 'en', { creditsTakenBack: 0 })).text,
    );
    expect(none).not.toContain('taken back');
  });

  it('never mentions the review queue, whatever the refund did', () => {
    for (const locale of ['en', 'ar'] as const) {
      const message = renderEmail(billingSpec('refund_notice', locale, { creditsTakenBack: 12 }));
      expect(`${message.subject}${message.text}${message.html}`).not.toMatch(
        /needs_review|review|shortfall|internal/i,
      );
    }
  });

  it('cancel and resume', () => {
    const end = read(renderEmail(billingSpec('subscription_canceled', 'en')).text);
    expect(end).toContain('Your Pro plan is canceled and ends on November 8, 2026');
    expect(end).toContain('resume the plan in Billing until November 8, 2026');
    const now = read(
      renderEmail(billingSpec('subscription_canceled', 'en', { endsAt: undefined })).text,
    );
    expect(now).toContain('canceling ended it right away');
    expect(now).not.toContain('resume the plan');
    const resumed = read(renderEmail(billingSpec('subscription_resumed', 'en')).text);
    expect(resumed).toContain('will renew as usual on November 8, 2026');
    expect(resumed).toContain('3 days before the month ends');
    expect(resumed).toContain('We never charge your card automatically.');
  });

  it('adds the support address only when there is one', () => {
    const with_ = renderEmail(billingSpec('payment_receipt', 'en')).text;
    expect(with_).toContain('Questions about a payment? Write to support@aivore.example.');
    const without = renderEmail(
      billingSpec('payment_receipt', 'en', { supportEmail: undefined }),
    ).text;
    expect(without).not.toContain('Questions about a payment');
  });

  it('names a pack or a plan the way a sentence needs it, in both languages', () => {
    expect(itemLabel('pack-500', 'en')).toBe('Small pack');
    expect(itemLabel('pack-500', 'ar')).toBe('حزمة صغيرة');
    expect(itemLabel('pro', 'en')).toBe('Pro plan');
    expect(itemLabel('pro', 'ar')).toBe('باقة المحترف');
    expect(itemLabel('retired-plan', 'en')).toBe('retired-plan');
  });
});

describe('punctuation', () => {
  /** What a reader sees of the HTML: no tags, no style block. */
  const visible = (html: string) =>
    read(html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const doubledStop = /(?<!\.)\.\.(?!\.)/;

  const variants: Array<[string, Record<string, unknown>]> = [
    ['a full refund', {}],
    ['a partial refund', { refundedHalalas: 3_475, refundedTotalHalalas: 3_475, planEnded: false }],
    ['a second partial refund', { refundedHalalas: 3_475, refundedTotalHalalas: 6_950 }],
    ['a refund before the credits', { credited: false, creditsTakenBack: 0, planEnded: false }],
  ];

  it.each(variants)(
    'the Arabic refund notice does not end a sentence with the riyal abbreviation and a second full stop (%s)',
    (_name, overrides) => {
      const message = renderEmail(billingSpec('refund_notice', 'ar', overrides));
      expect(visible(message.html)).not.toMatch(doubledStop);
      expect(read(message.text)).not.toMatch(doubledStop);
    },
  );

  it('the partial refund line ends with the amount and its own full stop, once', () => {
    const text = read(
      renderEmail(
        billingSpec('refund_notice', 'ar', {
          refundedHalalas: 3_475,
          refundedTotalHalalas: 3_475,
          planEnded: false,
        }),
      ).text,
    );
    expect(text).toContain('المبلغ المردود حتى الآن ٣٤٫٧٥ ر.س. من أصل ١٣٩٫٠٠ ر.س.');
    expect(text).not.toContain('ر.س..');
  });

  it.each(['en', 'ar'] as const)(
    'no billing message in %s has a doubled full stop anywhere',
    (locale) => {
      for (const kind of BILLING_EMAIL_KINDS) {
        const message = renderEmail(billingSpec(kind, locale));
        expect(visible(message.html), kind).not.toMatch(doubledStop);
        expect(read(message.text), kind).not.toMatch(doubledStop);
      }
    },
  );
});

describe('snapshots (structure and wording)', () => {
  const fixed = { name: 'Layla' };
  it('the receipt', () => {
    expect(renderEmail(billingSpec('payment_receipt', 'en', fixed)).html).toMatchSnapshot(
      'receipt-en-html',
    );
    expect(renderEmail(billingSpec('payment_receipt', 'ar', fixed)).html).toMatchSnapshot(
      'receipt-ar-html',
    );
    expect(renderEmail(billingSpec('payment_receipt', 'ar', fixed)).text).toMatchSnapshot(
      'receipt-ar-text',
    );
  });
  it('the renewal link', () => {
    expect(renderEmail(billingSpec('renewal_link', 'en', fixed)).text).toMatchSnapshot(
      'renewal-en-text',
    );
    expect(renderEmail(billingSpec('renewal_link', 'ar', fixed)).text).toMatchSnapshot(
      'renewal-ar-text',
    );
  });
  it('the refund notice and the expiry notice', () => {
    expect(renderEmail(billingSpec('refund_notice', 'ar', fixed)).text).toMatchSnapshot(
      'refund-ar-text',
    );
    expect(renderEmail(billingSpec('subscription_expired', 'en', fixed)).text).toMatchSnapshot(
      'expired-en-text',
    );
  });
});
