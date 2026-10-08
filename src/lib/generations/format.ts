/**
 * Small formatters shared by the studio and the gallery cards: elapsed time, credits and prompts as
 * people read them, in the active locale.
 */
import type { Translator } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locales';
import { formatNumber } from '@/lib/utils';

/** "0:07", "2:35", "1:02:03" with the digits of the locale. Negative or broken input reads as 0:00. */
export function formatElapsed(ms: number, locale: Locale): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) =>
    formatNumber(value, locale, { minimumIntegerDigits: 2, useGrouping: false });
  const one = (value: number) => formatNumber(value, locale, { useGrouping: false });
  return hours > 0
    ? `${one(hours)}:${two(minutes)}:${two(seconds)}`
    : `${one(minutes)}:${two(seconds)}`;
}

/**
 * Keeps a left-to-right token ("0:07", "16:9") in one piece inside right-to-left text: without it the
 * bidirectional algorithm can swap the sides of the colon.
 */
export function isolateLtr(text: string): string {
  return `\u2066${text}\u2069`;
}

/** "1 credit" / "رصيدان" / "50 credits": the grammar of the active language. */
export function creditsText({ plural, t }: Pick<Translator, 't' | 'plural'>, amount: number) {
  return plural(amount, {
    zero: t('studio.generations.credits.zero'),
    one: t('studio.generations.credits.one'),
    two: t('studio.generations.credits.two'),
    few: t('studio.generations.credits.few'),
    many: t('studio.generations.credits.many'),
    other: t('studio.generations.credits.other'),
  });
}

/** "2 images" / "صورتان". */
export function imagesText({ plural, t }: Pick<Translator, 't' | 'plural'>, count: number) {
  return plural(count, {
    zero: t('studio.units.images.zero'),
    one: t('studio.units.images.one'),
    two: t('studio.units.images.two'),
    few: t('studio.units.images.few'),
    many: t('studio.units.images.many'),
    other: t('studio.units.images.other'),
  });
}

/** The prompt on one line, cut at a word boundary when it is longer than `max` characters. */
export function clipText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max).join('');
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Characters as a person counts them (an emoji is one), which is also how the server counts. */
export function charCount(text: string): number {
  let count = 0;
  for (const _char of text) count += 1;
  return count;
}
