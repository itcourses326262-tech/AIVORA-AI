import type { PluralForms, TFunction, Translator } from '@/lib/i18n';
import { formatPlainNumber } from '@/lib/utils';

/** The numbers the legal text quotes. They come from the code that enforces them, never from the text. */
export interface LegalNumbers {
  /** VAT rate in percent (`VAT_RATE_PERCENT`). */
  vatPercent: number;
  /** Days before a paid month ends at which the renewal payment link is issued. */
  leadDays: number;
  /** Days after a month ends in which its renewal can still be paid. */
  graceDays: number;
  /** Days after a purchase in which a refund can be asked for. */
  refundDays: number;
}

export type LegalVariables = Readonly<Record<keyof LegalNumbers, string>>;

/** The six plural forms of "N days" in the active language (`legal.days.*`). */
export function daysForms(t: TFunction): PluralForms {
  return {
    zero: t('legal.days.zero'),
    one: t('legal.days.one'),
    two: t('legal.days.two'),
    few: t('legal.days.few'),
    many: t('legal.days.many'),
    other: t('legal.days.other'),
  };
}

/**
 * The values of the `{vatPercent}`, `{leadDays}`, `{graceDays}` and `{refundDays}` placeholders of
 * the legal text. Each day count is a whole phrase in the right plural form ("1 day", "7 days";
 * Arabic "يوم واحد", "يومين", "٧ أيام", "١٤ يومًا", "١٠٠ يوم"), because a number followed by a typed
 * plural word is wrong in most of the range of one of the two languages, and the owner is expected
 * to change the refund window.
 */
export function legalVariables(
  { locale, t, plural }: Pick<Translator, 'locale' | 't' | 'plural'>,
  numbers: LegalNumbers,
): LegalVariables {
  const days = daysForms(t);
  return {
    vatPercent: formatPlainNumber(numbers.vatPercent, locale),
    leadDays: plural(numbers.leadDays, days),
    graceDays: plural(numbers.graceDays, days),
    refundDays: plural(numbers.refundDays, days),
  };
}
