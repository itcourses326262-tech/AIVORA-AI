import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  acceptLanguage: null as string | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () =>
    new Headers(mocks.acceptLanguage ? { 'accept-language': mocks.acceptLanguage } : {}),
}));

import PricingPage, { generateMetadata } from '@/app/(marketing)/pricing/page';
import sitemap from '@/app/sitemap';
import { I18nProvider } from '@/lib/i18n/client';
import { UserProvider } from '@/lib/user-context';
import { resetEnvForTests } from '@/server/env';

type Locale = 'ar' | 'en';

async function render(locale: Locale = 'en') {
  mocks.cookies.set('aivore_locale', locale);
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <UserProvider initialUser={null}>{await PricingPage()}</UserProvider>
    </I18nProvider>,
  );
}

const plain = (html: string) => html.replace(/ /g, ' ').replace(/[‎‏]/g, '');

beforeEach(() => {
  mocks.cookies.clear();
  mocks.acceptLanguage = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe('the pricing page for a visitor', () => {
  it('renders one landmark with the skip-link target and exactly one h1', async () => {
    const html = await render();
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html).toContain('<main id="main-content"');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('Pay only for what you create');
  });

  it('has the sections of the brief, each labelled by its heading', async () => {
    const html = await render();
    const labelled = [...html.matchAll(/<section aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    expect(labelled).toEqual([
      'pricing-title',
      'pricing-plans-title',
      calculatorHeadingId(html),
      'pricing-trust-title',
      'pricing-faq-title',
    ]);
    for (const id of labelled) expect(html).toContain(`id="${id}"`);
  });

  it('shows the real prices of the shared price list', async () => {
    const html = plain(await render());
    for (const price of ['SAR 49', 'SAR 139', 'SAR 449']) expect(html).toContain(price);
    expect(html).toContain('VAT included: SAR 120.87 + SAR 18.13 VAT (15%)');
  });

  it('shows the VAT rate the server charges', async () => {
    vi.stubEnv('VAT_RATE_PERCENT', '10');
    resetEnvForTests();
    const html = plain(await render());
    expect(html).toContain('(10%)');
    expect(html).not.toContain('(15%)');
  });

  it('answers the billing questions and links the refund answer to the refund policy', async () => {
    const html = await render();
    expect(html.match(/<details /g)).toHaveLength(8);
    expect(html).toMatch(/<a [^>]*href="\/refunds"[^>]*>Refund policy<\/a>/);
    expect(html).toContain('do not store your card and never charge it on our own');
    expect(html).toContain('About 3 days before your month ends');
  });

  it('does not claim payment methods the gateway adapter was never shown to support', async () => {
    const html = (await render()).toLowerCase();
    for (const method of ['mada', 'apple pay', 'stc pay', 'visa', 'mastercard']) {
      expect(html, method).not.toContain(method);
    }
  });

  it('links the legal pages', async () => {
    const html = await render();
    for (const href of ['/refunds', '/terms', '/privacy']) expect(html).toContain(`href="${href}"`);
  });

  it('mentions the sign-up gift from the environment, and leaves it out at zero', async () => {
    vi.stubEnv('FIREBASE_API_KEY', 'k'.repeat(30));
    vi.stubEnv('FIREBASE_AUTH_DOMAIN', 'demo-project.firebaseapp.com');
    vi.stubEnv('FIREBASE_PROJECT_ID', 'demo-project');
    resetEnvForTests();
    expect(await render()).toContain('Sign up with Google and start with 50 credits on us.');
    vi.stubEnv('SIGNUP_BONUS_CREDITS', '0');
    resetEnvForTests();
    expect(await render()).not.toContain('start with');
  });

  it('promises the gift only where it can be earned: Google sign-in on, or password accounts paid', async () => {
    const promise = 'start with 50 credits on us';
    // The product policy without Google sign-in set up: nobody can earn it, so nothing is promised.
    vi.stubEnv('SIGNUP_BONUS_PROVIDER', 'google');
    resetEnvForTests();
    expect(plain(await render())).not.toContain(promise);
    // With Google sign-in set up it is promised, in both languages.
    vi.stubEnv('FIREBASE_API_KEY', 'k'.repeat(30));
    vi.stubEnv('FIREBASE_AUTH_DOMAIN', 'demo-project.firebaseapp.com');
    vi.stubEnv('FIREBASE_PROJECT_ID', 'demo-project');
    resetEnvForTests();
    expect(plain(await render())).toContain(promise);
    expect(plain(await render('ar'))).toContain('سجّل عبر Google وابدأ بـ ٥٠ رصيدًا هدية منا.');
  });
});

describe('the test-payments notice', () => {
  it('appears while the fake gateway is on (development and test)', async () => {
    vi.stubEnv('BILLING_GATEWAY', 'mock');
    resetEnvForTests();
    expect(await render()).toContain('Test payments');
  });

  it('is absent for a real gateway, and a closed shop says so instead', async () => {
    vi.stubEnv('BILLING_GATEWAY', 'off');
    resetEnvForTests();
    const html = await render();
    expect(html).not.toContain('Test payments');
    expect(html).toContain('Buying is paused');
    expect(html).toContain('Not available right now');
  });

  it('is absent in production, where the fake gateway can never run', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', 'x'.repeat(40));
    vi.stubEnv('BILLING_GATEWAY', 'auto');
    vi.stubEnv('MOYASAR_SECRET_KEY', '');
    resetEnvForTests();
    const html = await render();
    expect(html).not.toContain('Test payments');
    expect(html).toContain('Buying is paused');
  });
});

describe('Arabic', () => {
  it('renders right-to-left copy with riyals and Arabic-Indic digits', async () => {
    const html = plain(await render('ar'));
    expect(html).toContain('ادفع فقط مقابل ما تصنعه');
    expect(html).toContain('٤٩ ر.س.');
    expect(html).toContain('١٣٩ ر.س.');
    expect(html).toContain('٤٤٩ ر.س.');
    expect(html).not.toContain('SAR');
  });
});

describe('metadata and sitemap', () => {
  it('has a localized title and description and one canonical address', async () => {
    mocks.cookies.set('aivore_locale', 'en');
    const en = await generateMetadata();
    expect(en.title).toBe('Pricing');
    expect(en.alternates?.canonical).toBe('/pricing');
    mocks.cookies.set('aivore_locale', 'ar');
    const ar = await generateMetadata();
    expect(ar.title).toBe('الأسعار');
    expect(String(ar.description)).toContain('الريال السعودي');
  });

  it('is listed in the sitemap', () => {
    const urls = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(urls).toContain('/pricing');
    expect(urls.filter((path) => path === '/pricing')).toHaveLength(1);
  });
});

/** The calculator's heading id comes from `useId`; read it back from the markup. */
function calculatorHeadingId(html: string): string {
  const match = /<section aria-labelledby="([^"]+)" class="grid gap-6 rounded-2xl/.exec(html);
  return match?.[1] ?? 'calculator-title-not-found';
}
