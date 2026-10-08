import { describe, expect, it } from 'vitest';
import { creditsLabel } from '@/components/marketing/credits-label';
import { createTranslator } from '@/lib/i18n';

describe('creditsLabel', () => {
  const en = createTranslator('en');
  const ar = createTranslator('ar');

  it('uses English singular and plural', () => {
    expect([0, 1, 2, 50, 1200].map((n) => creditsLabel(en, n))).toEqual([
      '0 credits',
      '1 credit',
      '2 credits',
      '50 credits',
      '1,200 credits',
    ]);
  });

  it('uses the Arabic grammatical number: one, two, 3-10, 11-99 and the rest', () => {
    expect([0, 1, 2, 5, 50, 100, 125].map((n) => creditsLabel(ar, n))).toEqual([
      'بلا رصيد',
      'رصيد واحد',
      'رصيدان',
      '٥ أرصدة',
      '٥٠ رصيدًا',
      '١٠٠ رصيد',
      '١٢٥ رصيدًا',
    ]);
  });
});
