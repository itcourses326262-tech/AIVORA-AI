import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRICING_FAQ_KEYS } from '@/components/billing/pricing-faq';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from '@/lib/billing/plans';
import { ORDER_KINDS, ORDER_STATUSES } from '@/lib/billing/types';
import { createTranslator } from '@/lib/i18n';
import type { MessageTree } from '@/lib/i18n/define';
import billing from '@/lib/i18n/messages/billing';

function entries(tree: MessageTree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : entries(value, `${prefix}${key}.`),
  );
}

/** The distinct placeholders: a language may use one twice where the other uses it once. */
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((match) => match[1]))].sort();

const en = new Map(entries(billing.en));
const ar = new Map(entries(billing.ar));

function sourceFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => sourceFiles(join(path, name)));
}

const ROOTS = [
  'src/components/billing',
  'src/app/(marketing)/pricing',
  'src/app/(app)/billing',
  'src/app/(app)/account/billing',
].map((root) => join(process.cwd(), root));

const source = ROOTS.flatMap(sourceFiles)
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

describe('billing messages', () => {
  it('has the same keys and the same placeholders in English and Arabic', () => {
    expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
    expect(en.size).toBeGreaterThan(200);
    for (const [key, message] of en) {
      expect(placeholders(ar.get(key) ?? ''), key).toEqual(placeholders(message));
    }
  });

  it('has no empty message', () => {
    for (const [key, message] of [...en, ...ar]) expect(message.trim(), key).not.toBe('');
  });

  it('is really translated: every Arabic message has Arabic letters, no English message has any', () => {
    // `{name}` alone is the pack's own (already localized) name.
    const untranslated = [...ar]
      .filter(([, message]) => !/[؀-ۿ]/.test(message))
      .map(([key]) => key)
      .filter((key) => key !== 'account.orders.kind.pack');
    expect(untranslated).toEqual([]);
    for (const [key, message] of en) expect(message, key).not.toMatch(/[؀-ۿ]/);
  });

  it('writes Arabic sentences without ASCII digits: every number comes from a placeholder', () => {
    for (const [key, message] of ar) {
      expect(message.replace(/\{[^}]+\}/g, ''), key).not.toMatch(/\d/);
    }
  });

  it('never types a price: money only arrives as a placeholder, formatted with Intl', () => {
    for (const [key, message] of [...en, ...ar]) {
      expect(message, key).not.toMatch(/\bSAR\b|ر\.س|﷼/);
    }
  });

  it('defines every key the billing code asks for', () => {
    const used = new Set<string>();
    for (const match of source.matchAll(/['"`](billing\.[A-Za-z0-9_.]+)['"`]/g)) {
      used.add((match[1] as string).replace(/^billing\./, ''));
    }
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((key) => !en.has(key))).toEqual([]);
  });

  it('defines the keys built from a value: order kinds and statuses, plan phases, FAQ entries, plural forms', () => {
    for (const kind of ORDER_KINDS) expect(en.has(`account.orders.kind.${kind}`), kind).toBe(true);
    for (const status of ORDER_STATUSES) {
      expect(en.has(`account.orders.status.${status}`), status).toBe(true);
    }
    for (const phase of ['active', 'canceling', 'past_due', 'canceled', 'expired', 'incomplete']) {
      expect(en.has(`account.plan.status.${phase}`), phase).toBe(true);
    }
    for (const key of PRICING_FAQ_KEYS) {
      expect(en.has(`pricing.faq.items.${key}.question`), key).toBe(true);
      expect(en.has(`pricing.faq.items.${key}.answer`), key).toBe(true);
    }
    for (const kind of ['images', 'videos']) {
      for (const form of ['zero', 'one', 'two', 'few', 'many', 'other']) {
        expect(en.has(`pricing.calculator.${kind}.${form}`), `${kind}.${form}`).toBe(true);
      }
    }
  });

  it('has no message the code no longer uses: nothing in the dictionary is dead', () => {
    const dynamic = [
      'account.orders.kind.',
      'account.orders.status.',
      'account.plan.status.',
      'pricing.faq.items.',
      'pricing.calculator.images.',
      'pricing.calculator.videos.',
    ];
    const dead = [...en.keys()].filter(
      (key) =>
        !dynamic.some((prefix) => key.startsWith(prefix)) &&
        !source.includes(`billing.${key}`) &&
        !source.includes(`'${key}'`),
    );
    expect(dead).toEqual([]);
  });

  it('describes billing as built: renewal by link, never an automatic card charge', () => {
    const en = createTranslator('en');
    const ar = createTranslator('ar');
    expect(
      en.t('billing.pricing.faq.items.renewal.answer', { days: 3, grace: 7, vat: 15 }),
    ).toMatch(/do not store your card and never charge it/);
    expect(en.t('billing.confirm.renewalValue', { days: 3 })).toMatch(
      /never charge your card automatically/,
    );
    expect(ar.t('billing.confirm.renewalValue', { days: 3 })).toMatch(
      /ولا نخصم من بطاقتك تلقائيًا/,
    );
  });

  it('says the renewal link is emailed and a reminder follows, in the dialog, the FAQ and the plan card', () => {
    const en = createTranslator('en');
    const ar = createTranslator('ar');
    const faq = { days: 3, grace: 7, vat: 15 };
    expect(en.t('billing.confirm.renewalValue', { days: 3 })).toMatch(
      /we email you a payment link, and it also waits in Billing.*we send a reminder/,
    );
    expect(en.t('billing.pricing.faq.items.renewal.answer', faq)).toMatch(
      /we email you a payment link for the next month, and it also waits on your Billing page.*we send a reminder/,
    );
    expect(en.t('billing.account.plan.notes.renewal', { days: 3 })).toMatch(
      /we email it to you too/,
    );
    for (const text of [
      ar.t('billing.confirm.renewalValue', { days: 3 }),
      ar.t('billing.pricing.faq.items.renewal.answer', faq),
      ar.t('billing.account.plan.notes.renewal', { days: 3 }),
    ]) {
      expect(text).toMatch(/بالبريد/);
      // The old promise that nothing is ever sent must be gone, in both languages.
      expect(text).not.toMatch(/ولا نرسل تذكيرات/);
    }
    for (const text of [
      en.t('billing.confirm.renewalValue', { days: 3 }),
      en.t('billing.pricing.faq.items.renewal.answer', faq),
      en.t('billing.account.plan.notes.renewal', { days: 3 }),
    ]) {
      expect(text).not.toMatch(/do not send (payment )?reminders/i);
      // Email can get lost: Billing (or "here", on the Billing page itself) stays the place to look.
      expect(text).toMatch(/Billing|appears here/);
    }
  });

  it('does not promise that a plan is cheaper per credit: the Pro plan costs more per 100 credits than the large pack', () => {
    // The claim would be false for some pairs of the price list, so the text points to the figure
    // on every card instead.
    const claim = {
      en: /\b(lower|cheaper|less|discount|saves?)\b/i,
      ar: /(أقل|أرخص|أوفر|خصم|توفر)/,
    };
    for (const locale of ['en', 'ar'] as const) {
      const answer = createTranslator(locale).t('billing.pricing.faq.items.choose.answer');
      expect(answer, locale).not.toMatch(claim[locale]);
      expect(answer, locale).toMatch(locale === 'en' ? /price per 100 credits/ : /لكل ١٠٠ رصيد/);
    }
    const perCredit = (price: number, credits: number) => price / credits;
    const pro = SUBSCRIPTION_PLANS.find((plan) => plan.id === 'pro');
    const large = CREDIT_PACKS.find((pack) => pack.id === 'pack-5000');
    expect(perCredit(pro?.priceHalalas ?? 0, pro?.monthlyCredits ?? 1)).toBeGreaterThan(
      perCredit(large?.priceHalalas ?? 0, large?.credits ?? 1),
    );
  });

  it('is reachable through the translator in both languages', () => {
    expect(createTranslator('en').t('billing.cta.buy')).toBe('Buy now');
    expect(createTranslator('ar').t('billing.cta.buy')).toBe('اشترِ الآن');
    expect(createTranslator('en').t('billing.return.paid.title')).toBe('Payment received');
  });
});
