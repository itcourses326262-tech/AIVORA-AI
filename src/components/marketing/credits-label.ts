import type { Translator } from '@/lib/i18n';

/**
 * "50 credits" with the grammar of the active language: Arabic has distinct forms for one, two,
 * 3-10, 11-99 and the rest ("رصيد واحد", "رصيدان", "٥ أرصدة", "٥٠ رصيدًا", "١٠٠ رصيد").
 */
export function creditsLabel({ t, plural }: Pick<Translator, 't' | 'plural'>, amount: number) {
  return plural(amount, {
    zero: t('landing.credits.zero'),
    one: t('landing.credits.one'),
    two: t('landing.credits.two'),
    few: t('landing.credits.few'),
    many: t('landing.credits.many'),
    other: t('landing.credits.other'),
  });
}
