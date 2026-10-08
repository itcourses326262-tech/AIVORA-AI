import 'server-only';
import { createTranslator } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locales';
import { formatDateTime, formatNumber } from '@/lib/utils';
import type { EmailMessage } from '../types';
import { emailCopy } from './copy';
import { escapeHtml, renderLayout, singleLine, type Paragraph } from './layout';

type Dictionary = (typeof emailCopy)['en'];

interface Value {
  value: string;
  /** Typed left to right inside right-to-left text (addresses, links, dates). */
  ltr?: boolean;
  strong?: boolean;
}

const LRI = String.fromCodePoint(0x2066);
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

/**
 * Fills `{name}` placeholders. HTML output escapes every value and wraps it in an isolated span,
 * so an address or a name in Latin script cannot reorder the Arabic sentence around it; plain
 * text gets the Unicode isolates instead. A placeholder without a value stays visible.
 */
function fill(template: string, values: Readonly<Record<string, Value>>, locale: Locale) {
  let html = '';
  let text = '';
  for (const part of template.split(/(\{\w+\})/)) {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    const entry = key !== undefined && Object.hasOwn(values, key) ? values[key] : undefined;
    if (!entry) {
      html += escapeHtml(part);
      text += part;
      continue;
    }
    const value = singleLine(entry.value);
    const inner = escapeHtml(value);
    const wrapped = `<span dir="${entry.ltr ? 'ltr' : 'auto'}" style="unicode-bidi:isolate">${inner}</span>`;
    html += entry.strong ? `<strong>${wrapped}</strong>` : wrapped;
    text += locale === 'ar' ? `${entry.ltr ? LRI : FSI}${value}${PDI}` : value;
  }
  return { html, text };
}

function paragraph(
  template: string,
  values: Readonly<Record<string, Value>>,
  locale: Locale,
  tone?: Paragraph['tone'],
): Paragraph {
  return { ...fill(template, values, locale), ...(tone ? { tone } : {}) };
}

/** "24 hours" / "ساعة واحدة": Intl knows the Arabic plural forms. */
function duration(locale: Locale, unit: 'hour' | 'minute', amount: number): string {
  return formatNumber(amount, locale, { style: 'unit', unit, unitDisplay: 'long' });
}

/** "50 credits" / "٥٠ رصيدًا": the plural form already carries the number. */
function creditsLabel(locale: Locale, amount: number): string {
  const { t, plural } = createTranslator(locale);
  return plural(amount, {
    zero: t('landing.credits.zero'),
    one: t('landing.credits.one'),
    two: t('landing.credits.two'),
    few: t('landing.credits.few'),
    many: t('landing.credits.many'),
    other: t('landing.credits.other'),
  });
}

interface Common {
  locale: Locale;
  to: string;
  name: string;
}

export type EmailSpec =
  | (Common & {
      kind: 'verification';
      link: string;
      ttlHours: number;
      /** Credits the confirmation unlocks (0 or absent: no bonus line). */
      bonusCredits?: number;
    })
  | (Common & { kind: 'password_reset'; link: string; ttlHours: number })
  | (Common & {
      kind: 'password_changed';
      /** Where the user can start a reset if it was not them. */
      link: string;
      at: number;
    })
  | (Common & { kind: 'welcome'; link: string; bonusCredits?: number })
  | (Common & { kind: 'account_deleted' });

/** Builds the subject, HTML and plain-text bodies of one email. Pure: no I/O, no clock. */
export function renderEmail(spec: EmailSpec): EmailMessage {
  const { locale } = spec;
  const c: Dictionary = emailCopy[locale];
  const to = spec.to;
  const email: Value = { value: to, ltr: true, strong: true };
  const name: Value = { value: spec.name };
  const greeting = paragraph(c.shared.greeting, { name }, locale);

  const base = { locale, brand: c.brand, linkHint: c.shared.linkHint };
  const footer = paragraph(c.shared.sentTo, { email: { value: to, ltr: true } }, locale, 'muted');

  switch (spec.kind) {
    case 'verification': {
      const lines: Paragraph[] = [greeting, paragraph(c.verification.intro, { email }, locale)];
      if (spec.bonusCredits && spec.bonusCredits > 0) {
        const credits: Value = { value: creditsLabel(locale, spec.bonusCredits), strong: true };
        lines.push(paragraph(c.verification.bonus, { credits }, locale));
      }
      lines.push(
        paragraph(
          c.verification.expiry,
          { duration: { value: duration(locale, 'hour', spec.ttlHours) } },
          locale,
          'muted',
        ),
        paragraph(c.verification.ignore, {}, locale, 'muted'),
      );
      return build(spec, c.verification.subject, {
        ...base,
        subject: c.verification.subject,
        preheader: c.verification.preheader,
        heading: c.verification.heading,
        paragraphs: lines,
        action: { label: c.verification.action, url: spec.link },
        footer,
      });
    }
    case 'password_reset':
      return build(spec, c.passwordReset.subject, {
        ...base,
        subject: c.passwordReset.subject,
        preheader: c.passwordReset.preheader,
        heading: c.passwordReset.heading,
        paragraphs: [
          greeting,
          paragraph(c.passwordReset.intro, { email }, locale),
          paragraph(
            c.passwordReset.expiry,
            { duration: { value: duration(locale, 'hour', spec.ttlHours) } },
            locale,
            'muted',
          ),
          paragraph(c.passwordReset.ignore, {}, locale, 'muted'),
          paragraph(c.passwordReset.secret, {}, locale, 'muted'),
        ],
        action: { label: c.passwordReset.action, url: spec.link },
        footer,
      });
    case 'password_changed':
      return build(spec, c.passwordChanged.subject, {
        ...base,
        subject: c.passwordChanged.subject,
        preheader: c.passwordChanged.preheader,
        heading: c.passwordChanged.heading,
        paragraphs: [
          greeting,
          paragraph(
            c.passwordChanged.intro,
            { email, time: { value: `${formatDateTime(spec.at, locale, 'UTC')} UTC`, ltr: true } },
            locale,
          ),
          paragraph(c.passwordChanged.warning, {}, locale, 'warning'),
        ],
        action: { label: c.passwordChanged.action, url: spec.link },
        footer,
      });
    case 'welcome': {
      const lines: Paragraph[] = [greeting, paragraph(c.welcome.intro, {}, locale)];
      if (spec.bonusCredits && spec.bonusCredits > 0) {
        const credits: Value = { value: creditsLabel(locale, spec.bonusCredits), strong: true };
        lines.push(paragraph(c.welcome.bonus, { credits }, locale));
      }
      return build(spec, c.welcome.subject, {
        ...base,
        subject: c.welcome.subject,
        preheader: c.welcome.preheader,
        heading: c.welcome.heading,
        paragraphs: lines,
        action: { label: c.welcome.action, url: spec.link },
        footer,
      });
    }
    case 'account_deleted':
      return build(spec, c.accountDeleted.subject, {
        ...base,
        subject: c.accountDeleted.subject,
        preheader: c.accountDeleted.preheader,
        heading: c.accountDeleted.heading,
        paragraphs: [
          greeting,
          paragraph(c.accountDeleted.intro, { email }, locale),
          paragraph(c.accountDeleted.records, {}, locale, 'muted'),
          paragraph(c.accountDeleted.warning, {}, locale, 'warning'),
        ],
        footer,
      });
  }
}

function build(
  spec: EmailSpec,
  subject: string,
  layout: Parameters<typeof renderLayout>[0],
): EmailMessage {
  const { html, text } = renderLayout(layout);
  return {
    kind: spec.kind,
    to: spec.to,
    subject: singleLine(subject),
    html,
    text,
    locale: spec.locale,
  };
}
