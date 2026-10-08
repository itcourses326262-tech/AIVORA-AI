import type { Locale } from '@/lib/i18n/locales';
import { formatNumber } from '@/lib/utils';
import { BILLING_CURRENCY, HALALAS_PER_SAR } from './types';

export interface FormatMoneyOptions {
  /**
   * `auto` (default) drops ".00" from whole riyals ("SAR 29"), which suits price tags; use `2`
   * for invoices and VAT breakdowns where every line needs two decimals.
   */
  fractionDigits?: 'auto' | 2;
}

/**
 * Formats halalas as Saudi riyals with `Intl`: "SAR 29.00" in English, "٢٩٫٠٠ ر.س." in Arabic
 * (Arabic-Indic digits, like every number in the Arabic UI).
 */
export function formatMoney(
  halalas: number,
  locale: Locale,
  { fractionDigits = 'auto' }: FormatMoneyOptions = {},
): string {
  const whole = halalas % HALALAS_PER_SAR === 0;
  const digits = fractionDigits === 'auto' && whole ? 0 : 2;
  return formatNumber(halalas / HALALAS_PER_SAR, locale, {
    style: 'currency',
    currency: BILLING_CURRENCY,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
