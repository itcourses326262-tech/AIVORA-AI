import { describe, expect, it } from 'vitest';
import { formatMoney } from '@/lib/billing/format';
import { DAY_MS, RENEWAL_GRACE_MS, RENEWAL_LEAD_MS, addMonthsUtc } from '@/lib/billing/period';
import { mockCheckoutMessages } from '@/lib/billing/mock-checkout-messages';

describe('addMonthsUtc', () => {
  const at = (y: number, m: number, d: number, h = 10) => Date.UTC(y, m - 1, d, h, 30, 15, 250);

  it('adds calendar months and keeps the time of day', () => {
    expect(addMonthsUtc(at(2026, 10, 8), 1)).toBe(at(2026, 11, 8));
    expect(addMonthsUtc(at(2026, 12, 15), 1)).toBe(at(2027, 1, 15));
    expect(addMonthsUtc(at(2026, 1, 1), 12)).toBe(at(2027, 1, 1));
  });

  it('clamps to the end of a short month without drifting', () => {
    expect(addMonthsUtc(at(2026, 1, 31), 1)).toBe(at(2026, 2, 28));
    expect(addMonthsUtc(at(2028, 1, 31), 1)).toBe(at(2028, 2, 29));
    // Renewing from the clamped date with the anchor day goes back to the 31st.
    expect(addMonthsUtc(at(2026, 2, 28), 1, 31)).toBe(at(2026, 3, 31));
    expect(addMonthsUtc(at(2026, 3, 31), 1, 31)).toBe(at(2026, 4, 30));
    expect(addMonthsUtc(at(2026, 4, 30), 1, 31)).toBe(at(2026, 5, 31));
  });

  it('twelve renewals from the 31st land on the same day of the next year', () => {
    let current = at(2026, 1, 31);
    for (let i = 0; i < 12; i += 1) current = addMonthsUtc(current, 1, 31);
    expect(current).toBe(at(2027, 1, 31));
  });

  it('is strictly increasing', () => {
    let current = at(2026, 1, 31);
    for (let i = 0; i < 40; i += 1) {
      const next = addMonthsUtc(current, 1, 31);
      expect(next).toBeGreaterThan(current);
      current = next;
    }
  });

  it('gives the renewal a sensible window inside a month', () => {
    expect(RENEWAL_LEAD_MS).toBe(3 * DAY_MS);
    expect(RENEWAL_GRACE_MS).toBe(7 * DAY_MS);
    expect(RENEWAL_LEAD_MS + RENEWAL_GRACE_MS).toBeLessThan(28 * DAY_MS);
  });
});

/** Intl separates the currency from the number with a no-break space. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('formatMoney', () => {
  it('formats halalas as riyals in English', () => {
    expect(plain(formatMoney(2900, 'en'))).toBe('SAR 29');
    expect(plain(formatMoney(2950, 'en'))).toBe('SAR 29.50');
    expect(plain(formatMoney(2900, 'en', { fractionDigits: 2 }))).toBe('SAR 29.00');
    expect(plain(formatMoney(123_456, 'en'))).toBe('SAR 1,234.56');
    expect(plain(formatMoney(5, 'en'))).toBe('SAR 0.05');
  });

  it('formats halalas as riyals in Arabic with Arabic-Indic digits', () => {
    const text = formatMoney(2950, 'ar');
    expect(text).toMatch(/٢٩٫٥٠/);
    expect(text).toMatch(/ر\.س/);
    expect(formatMoney(2900, 'ar')).toMatch(/٢٩/);
    expect(formatMoney(2900, 'ar')).not.toMatch(/٢٩٫٠٠/);
    expect(formatMoney(2900, 'ar', { fractionDigits: 2 })).toMatch(/٢٩٫٠٠/);
  });
});

describe('mock checkout messages', () => {
  it('have the same keys and the same placeholders in both languages', () => {
    expect(Object.keys(mockCheckoutMessages.ar).sort()).toEqual(
      Object.keys(mockCheckoutMessages.en).sort(),
    );
    for (const key of Object.keys(mockCheckoutMessages.en) as Array<
      keyof typeof mockCheckoutMessages.en
    >) {
      expect(mockCheckoutMessages.ar[key].length, key).toBeGreaterThan(0);
      expect(mockCheckoutMessages.ar[key], key).toMatch(/[؀-ۿ]/);
      const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(mockCheckoutMessages.ar[key])).toEqual(
        placeholders(mockCheckoutMessages.en[key]),
      );
    }
  });
});
