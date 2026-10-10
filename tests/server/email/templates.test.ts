import { describe, expect, it } from 'vitest';
import { renderEmail, type EmailSpec } from '@/server/email';
import { escapeHtml, singleLine } from '@/server/email/templates/layout';
import { EMAIL_KINDS } from '@/server/email';
import type { Locale } from '@/lib/i18n/locales';
import { billingSpec } from './billing-fixtures';

const LINK = 'https://aivore.example/verify-email?token=abc_DEF-123';
const NAME = 'Layla <b>"Q"</b> & Co';
const EMAIL = 'layla@example.com';

function spec(
  kind: EmailSpec['kind'],
  locale: Locale,
  overrides: Partial<EmailSpec> = {},
): EmailSpec {
  const common = { locale, to: EMAIL, name: NAME };
  switch (kind) {
    case 'verification':
      return {
        ...common,
        kind,
        link: LINK,
        ttlHours: 24,
        ...overrides,
      } as EmailSpec;
    case 'password_reset':
      return { ...common, kind, link: LINK, ttlHours: 1, ...overrides } as EmailSpec;
    case 'password_changed':
      return {
        ...common,
        kind,
        link: LINK,
        at: Date.UTC(2026, 9, 8, 12, 30),
        ...overrides,
      } as EmailSpec;
    case 'welcome':
      return { ...common, kind, link: LINK, bonusCredits: 50, ...overrides } as EmailSpec;
    case 'account_deleted':
      return { ...common, kind, ...overrides } as EmailSpec;
    default:
      return billingSpec(kind, locale, overrides);
  }
}

describe('renderEmail', () => {
  describe.each(['en', 'ar'] as const)('%s', (locale) => {
    it.each(EMAIL_KINDS)('renders %s completely', (kind) => {
      const message = renderEmail(spec(kind, locale));
      expect(message).toMatchObject({ kind, to: EMAIL, locale });
      expect(message.subject.trim()).not.toBe('');
      expect(message.subject).not.toMatch(/[\r\n]/);
      for (const body of [message.subject, message.html, message.text]) {
        expect(body, 'unfilled placeholder').not.toMatch(
          /\{(?:name|email|credits|duration|time)\}/,
        );
      }
      // No layout markup (the name above is deliberately hostile and stays as typed).
      expect(message.text).not.toMatch(/<\/?(?:html|body|table|tr|td|p|div|span|a|style|h1)\b/i);
      expect(message.html.startsWith('<!doctype html>')).toBe(true);
    });

    it('escapes every interpolated value', () => {
      const message = renderEmail(spec('verification', locale));
      expect(message.html).not.toContain('<b>');
      expect(message.html).not.toContain('"Q"');
      expect(message.html).toContain('Layla &lt;b&gt;&quot;Q&quot;&lt;/b&gt; &amp; Co');
      // The plain-text version keeps the characters as they are: it has no markup to break.
      expect(message.text).toContain(NAME);
    });

    it('cannot be turned into markup through the address or the link', () => {
      const evil = renderEmail(
        spec('password_reset', locale, {
          to: '"><script>alert(1)</script>@example.com',
          link: 'https://aivore.example/reset-password?token=a&b="x"><script>',
        }),
      );
      expect(evil.html).not.toContain('<script>');
      expect(evil.html).not.toMatch(/href="[^"]*"[^>]*"><script/);
      expect(evil.html).toContain('token=a&amp;b=%22x%22%3E%3Cscript%3E');
    });

    it('loads nothing from the network: no images, styles, scripts or fonts', () => {
      const { html } = renderEmail(spec('welcome', locale));
      expect(html).not.toMatch(/<img|<script|<link|<iframe|<video|@import|@font-face/i);
      expect(html).not.toMatch(/url\(/i);
      expect(html).not.toMatch(/\ssrc=/i);
      // The only absolute URLs are links the person may click.
      const urls = [...html.matchAll(/https?:\/\/[^"'\s<)]+/g)].map((m) => m[0]);
      expect(urls.every((url) => url.startsWith('https://aivore.example/'))).toBe(true);
    });

    it('refuses a link that is not http(s)', () => {
      expect(() =>
        renderEmail(
          spec('verification', locale, { link: 'javascript:alert(1)' } as Partial<EmailSpec>),
        ),
      ).toThrow(/http/);
    });

    it('puts the action link in the button and in the plain text', () => {
      const message = renderEmail(spec('verification', locale));
      expect(message.html).toContain(`href="${LINK}"`);
      expect(message.text).toContain(LINK);
    });
  });

  it('is left to right in English', () => {
    const { html } = renderEmail(spec('verification', 'en'));
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('<body class="page" dir="ltr"');
    expect(html).toContain('text-align:left');
    expect(html).not.toContain('text-align:right');
  });

  it('is right to left in Arabic: document, body, tables and text', () => {
    const { html } = renderEmail(spec('verification', 'ar'));
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('<body class="page" dir="rtl"');
    expect(html.match(/<table[^>]*dir="rtl"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('text-align:right');
    expect(html).not.toContain('text-align:left');
    // An Arabic-capable font stack, and the Latin wordmark and address isolated left to right.
    expect(html).toContain('Tahoma');
    expect(html).toMatch(/<span dir="ltr"[^>]*>AIVORE<\/span>/);
    expect(html).toMatch(/<span dir="ltr"[^>]*>layla@example\.com<\/span>/);
  });

  it('keeps Latin text from reordering Arabic plain text with Unicode isolates', () => {
    const { text } = renderEmail(spec('verification', 'ar'));
    const LRI = String.fromCodePoint(0x2066);
    const PDI = String.fromCodePoint(0x2069);
    expect(text).toContain(`${LRI}${EMAIL}${PDI}`);
    const english = renderEmail(spec('verification', 'en')).text;
    expect(english).not.toContain(LRI);
  });

  it('uses Arabic grammar and digits for the expiry and for the credits the welcome mail reports', () => {
    // Format characters (the bidi isolates) are invisible; compare what a person reads.
    const plain = (text: string) => text.replace(/\p{Cf}/gu, '');
    const text = plain(renderEmail(spec('verification', 'ar')).text);
    expect(text).toContain('٢٤ ساعة');
    const reset = renderEmail(spec('password_reset', 'ar')).text;
    expect(reset).toMatch(/ساعة/);
    expect(plain(renderEmail(spec('welcome', 'ar')).text)).toContain(
      'أضفنا ٥٠ رصيدًا مجانًا إلى رصيدك لتبدأ فورًا.',
    );
    expect(renderEmail(spec('welcome', 'en')).text).toContain(
      'We added your sign-up bonus of 50 credits to your balance so you can start right away.',
    );
    expect(
      renderEmail(spec('welcome', 'en', { bonusCredits: 1 } as Partial<EmailSpec>)).text,
    ).toContain('sign-up bonus of 1 credit');
    expect(renderEmail(spec('verification', 'en')).text).toContain('24 hours');
  });

  it('leaves the credits line out of the welcome mail when none were given', () => {
    for (const locale of ['en', 'ar'] as const) {
      const none = renderEmail(spec('welcome', locale, { bonusCredits: 0 } as Partial<EmailSpec>));
      expect(none.text, locale).not.toMatch(/credit|bonus|رصيد|مجان/i);
      expect(none.html, locale).not.toMatch(/credit|bonus|رصيد|مجان/i);
      // The line is the only difference: the rest of the mail is still there.
      expect(none.text.length).toBeGreaterThan(40);
    }
  });

  it('never promises credits in the confirmation mail: confirming an address pays none', () => {
    for (const locale of ['en', 'ar'] as const) {
      // Even a caller from before this rule (a stale spec with a bonus) cannot make it promise any.
      const stale = { bonusCredits: 50 } as Partial<EmailSpec>;
      for (const overrides of [{}, stale]) {
        const mail = renderEmail(spec('verification', locale, overrides));
        for (const body of [mail.subject, mail.text, mail.html]) {
          expect(body, locale).not.toMatch(/credit|bonus|free|رصيد|مجان|هدية|مكافأة/i);
        }
      }
    }
  });

  it('states the time of a password change in UTC', () => {
    expect(renderEmail(spec('password_changed', 'en')).text).toContain('UTC');
  });

  it('matches the stored snapshots (structure and wording)', () => {
    const fixed = { name: 'Layla' } as Partial<EmailSpec>;
    expect(renderEmail(spec('verification', 'en', fixed)).html).toMatchSnapshot(
      'verification-en-html',
    );
    expect(renderEmail(spec('verification', 'ar', fixed)).html).toMatchSnapshot(
      'verification-ar-html',
    );
    expect(renderEmail(spec('verification', 'ar', fixed)).text).toMatchSnapshot(
      'verification-ar-text',
    );
    expect(renderEmail(spec('password_reset', 'en', fixed)).text).toMatchSnapshot('reset-en-text');
  });
});

describe('escapeHtml and singleLine', () => {
  it('escapes the five dangerous characters and nothing else', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
    expect(escapeHtml('plain عربي 123')).toBe('plain عربي 123');
  });

  it('flattens line breaks so a value cannot split a header', () => {
    expect(singleLine('a\r\nBcc: x@y.z')).toBe('a Bcc: x@y.z');
    expect(singleLine(`a${String.fromCodePoint(0x2028)}b`)).toBe('a b');
  });
});
