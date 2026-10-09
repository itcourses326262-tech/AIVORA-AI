import { describe, expect, it } from 'vitest';
import { daysForms, legalVariables, type LegalNumbers } from '@/components/legal/variables';
import { createTranslator } from '@/lib/i18n';

const NUMBERS: LegalNumbers = { vatPercent: 15, leadDays: 3, graceDays: 7, refundDays: 7 };

describe('legalVariables: day counts are whole phrases in the right plural form', () => {
  // [days, English, Arabic]. Arabic has six forms: 1 and 2 are words, 3-10 take the plural noun,
  // 11-99 the singular accusative, and 100, 101, ... the bare singular.
  it.each([
    [1, '1 day', 'يوم واحد'],
    [2, '2 days', 'يومين'],
    [3, '3 days', '٣ أيام'],
    [7, '7 days', '٧ أيام'],
    [10, '10 days', '١٠ أيام'],
    [11, '11 days', '١١ يومًا'],
    [14, '14 days', '١٤ يومًا'],
    [30, '30 days', '٣٠ يومًا'],
    [99, '99 days', '٩٩ يومًا'],
    [100, '100 days', '١٠٠ يوم'],
    [101, '101 days', '١٠١ يوم'],
    [102, '102 days', '١٠٢ يوم'],
  ])('%i days', (days, english, arabic) => {
    for (const [locale, expected] of [
      ['en', english],
      ['ar', arabic],
    ] as const) {
      const variables = legalVariables(createTranslator(locale), {
        ...NUMBERS,
        leadDays: days,
        graceDays: days,
        refundDays: days,
      });
      expect(variables.leadDays, `${locale} lead`).toBe(expected);
      expect(variables.graceDays, `${locale} grace`).toBe(expected);
      expect(variables.refundDays, `${locale} refund`).toBe(expected);
    }
  });

  it('never leaves a typed plural word behind a number in either language', () => {
    for (const days of [1, 2, 3, 7, 11, 14, 30]) {
      expect(
        legalVariables(createTranslator('en'), { ...NUMBERS, refundDays: days }).refundDays,
      ).toMatch(days === 1 ? /^1 day$/ : /^\d+ days$/);
    }
  });

  it('writes the VAT rate as a plain number in the digits of the language', () => {
    expect(legalVariables(createTranslator('en'), NUMBERS).vatPercent).toBe('15');
    expect(legalVariables(createTranslator('ar'), NUMBERS).vatPercent).toBe('١٥');
    expect(legalVariables(createTranslator('en'), { ...NUMBERS, vatPercent: 7.5 }).vatPercent).toBe(
      '7.5',
    );
    expect(legalVariables(createTranslator('en'), { ...NUMBERS, vatPercent: 0 }).vatPercent).toBe(
      '0',
    );
  });

  it('gives the numbers the billing code uses today', () => {
    expect(legalVariables(createTranslator('en'), NUMBERS)).toEqual({
      vatPercent: '15',
      leadDays: '3 days',
      graceDays: '7 days',
      refundDays: '7 days',
    });
    expect(legalVariables(createTranslator('ar'), NUMBERS)).toEqual({
      vatPercent: '١٥',
      leadDays: '٣ أيام',
      graceDays: '٧ أيام',
      refundDays: '٧ أيام',
    });
  });
});

describe('daysForms', () => {
  it('has all six forms, in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      const forms = daysForms(createTranslator(locale).t);
      expect(Object.keys(forms).sort()).toEqual(['few', 'many', 'one', 'other', 'two', 'zero']);
      for (const form of Object.values(forms)) expect(form.trim()).not.toBe('');
    }
  });
});
