import { describe, expect, it } from 'vitest';
import { createTranslator, type MessageKey } from '@/lib/i18n';
import { emailCopy } from '@/server/email/templates/copy';

/*
 * The free sign-up credits are for accounts created with Google sign-in. Copy that PROMISES them
 * must say so (and only appear where a number is passed), and copy that cannot know whether they
 * exist, or that is about confirming an email address, must not promise them at all.
 */

const LOCALES = ['en', 'ar'] as const;

/** A sentence that promises free credits, gifts or a bonus, in either language. */
const PROMISES: Record<(typeof LOCALES)[number], RegExp> = {
  en: /free credits?|credits? free|sign-up (?:bonus|credits)|credits on sign-?up|with credits|\bon us\b|\bgift\b|\bbonus\b/i,
  ar: /هدية|مكافأة|مجانًا|رصيد(?:ًا)? مجاني/,
};

/** Offers: shown only with a positive amount, and they name the way to earn it. */
const OFFERS = [
  'landing.hero.trust',
  'landing.pricing.freeLead',
  'landing.faq.items.free.answer',
  'billing.pricing.hero.bonus',
] as const satisfies readonly MessageKey[];

/** Copy that is always shown: it must stay true whether or not anybody can earn the credits. */
const NEVER_PROMISING = [
  'landing.meta.description',
  'landing.hero.trustNoBonus',
  'landing.finalCta.description',
  'landing.faq.items.free.answerNoBonus',
  'billing.meta.pricingDescription',
  'billing.pricing.confirmEmail.title',
  'billing.pricing.confirmEmail.body',
  'studio.confirmEmail.title',
  'studio.confirmEmail.body',
  'account.docs.quickstart.steps.setup.body',
] as const;

function text(locale: (typeof LOCALES)[number], key: string): string {
  const { t } = createTranslator(locale);
  return t(key as MessageKey, { credits: '50 credits', email: 'a@b.c', count: 3 });
}

describe.each(LOCALES)('free sign-up credits copy (%s)', (locale) => {
  it.each(OFFERS)('%s names Google sign-in as the way to earn them', (key) => {
    expect(text(locale, key)).toContain('Google');
  });

  it.each(OFFERS.filter((key) => key !== 'landing.pricing.freeLead'))(
    '%s is a whole sentence about the credits (freeLead is the lead-in to the amount)',
    (key) => {
      expect(text(locale, key)).toMatch(PROMISES[locale]);
    },
  );

  it.each(['landing.hero.trust', 'billing.pricing.hero.bonus'] as const)(
    '%s carries the amount',
    (key) => {
      const { t } = createTranslator(locale);
      expect(t(key, { credits: 'AMOUNT' })).toContain('AMOUNT');
    },
  );

  it.each(NEVER_PROMISING)('%s promises no credits', (key) => {
    expect(text(locale, key)).not.toMatch(PROMISES[locale]);
  });

  it('keeps the ledger label of the sign-up credit as it was', () => {
    const label = text(locale, 'account.credits.reasons.signup_bonus');
    expect(label).toBe(locale === 'en' ? 'Welcome bonus' : 'هدية الترحيب');
  });

  it('has no credits placeholder in the notices that ask to confirm an address', () => {
    for (const key of [
      'billing.pricing.confirmEmail.body',
      'studio.confirmEmail.body',
      'studio.confirmEmail.title',
    ] as const) {
      const { t } = createTranslator(locale);
      // A message with a {credits} slot left unfilled would print the braces.
      expect(t(key, { email: 'a@b.c' }), key).not.toContain('{credits}');
    }
  });
});

describe.each(LOCALES)('emails (%s)', (locale) => {
  it('the confirmation mail has no credits line, since confirming pays none', () => {
    const copy = emailCopy[locale].verification as Record<string, string>;
    expect(Object.keys(copy)).not.toContain('bonus');
    for (const value of Object.values(copy)) expect(value).not.toMatch(PROMISES[locale]);
  });

  it('the welcome mail states the credits as a fact, with their amount', () => {
    const copy = emailCopy[locale].welcome;
    expect(copy.bonus).toContain('{credits}');
  });
});
