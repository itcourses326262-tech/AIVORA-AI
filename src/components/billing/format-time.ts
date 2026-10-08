import { intlTag } from '@/lib/utils';
import type { Locale } from '@/lib/i18n/locales';

/** "3:42:10 PM" / "٣:٤٢:١٠ م": the time of day, in the language's own digits. */
export function formatTimeOfDay(timestampMs: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlTag(locale), { timeStyle: 'medium' }).format(timestampMs);
}
