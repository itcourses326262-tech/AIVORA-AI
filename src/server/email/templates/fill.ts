import 'server-only';
import { createTranslator } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locales';
import { formatNumber } from '@/lib/utils';
import { escapeHtml, singleLine, type Paragraph } from './layout';

/** Who a message is for and in which language it is written. */
export interface Common {
  locale: Locale;
  to: string;
  name: string;
}

/** One value for a `{placeholder}` of an email sentence. */
export interface Value {
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
export function fill(template: string, values: Readonly<Record<string, Value>>, locale: Locale) {
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

export function paragraph(
  template: string,
  values: Readonly<Record<string, Value>>,
  locale: Locale,
  tone?: Paragraph['tone'],
): Paragraph {
  return { ...fill(template, values, locale), ...(tone ? { tone } : {}) };
}

/** "24 hours" / "ساعة واحدة": Intl knows the Arabic plural forms. */
export function duration(locale: Locale, unit: 'hour' | 'minute' | 'day', amount: number): string {
  return formatNumber(amount, locale, { style: 'unit', unit, unitDisplay: 'long' });
}

/** "50 credits" / "٥٠ رصيدًا": the plural form already carries the number. */
export function creditsLabel(locale: Locale, amount: number): string {
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

/** Fills `{name}` placeholders of a single-line string (subjects, preheaders): no markup, no isolates. */
export function plain(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? singleLine(values[key] ?? '') : whole,
  );
}
