import { isValidElement, type ReactElement } from 'react';
import type * as LegalModule from '@/lib/legal';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  acceptLanguage: null as string | null,
  draft: true,
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
// The flag is a constant in the source; the owner flips it. Tests flip it through a getter.
vi.mock('@/lib/legal', async (importOriginal) => ({
  ...(await importOriginal<typeof LegalModule>()),
  get LEGAL_DRAFT() {
    return mocks.draft;
  },
}));

import AcceptableUsePage, {
  generateMetadata as aupMetadata,
} from '@/app/(marketing)/acceptable-use/page';
import PrivacyPage, { generateMetadata as privacyMetadata } from '@/app/(marketing)/privacy/page';
import RefundsPage, { generateMetadata as refundsMetadata } from '@/app/(marketing)/refunds/page';
import TermsPage, { generateMetadata as termsMetadata } from '@/app/(marketing)/terms/page';
import { LegalDocument } from '@/components/legal/legal-document';
import { anchorOf, sectionIdsOf } from '@/components/legal/outline';
import { COMPANY_ENV, COMPANY_FIELDS, LEGAL_MESSAGE_KEY, type LegalSlug } from '@/lib/legal';

type Locale = 'ar' | 'en';

const PAGES = [
  {
    slug: 'terms',
    Page: TermsPage,
    metadata: termsMetadata,
    title: { en: 'Terms of Service', ar: 'شروط الخدمة' },
  },
  {
    slug: 'privacy',
    Page: PrivacyPage,
    metadata: privacyMetadata,
    title: { en: 'Privacy Policy', ar: 'سياسة الخصوصية' },
  },
  {
    slug: 'refunds',
    Page: RefundsPage,
    metadata: refundsMetadata,
    title: { en: 'Refund Policy', ar: 'سياسة الاسترداد' },
  },
  {
    slug: 'acceptable-use',
    Page: AcceptableUsePage,
    metadata: aupMetadata,
    title: { en: 'Acceptable Use Policy', ar: 'سياسة الاستخدام المقبول' },
  },
] as const satisfies ReadonlyArray<{
  slug: LegalSlug;
  Page: () => ReactElement;
  metadata: () => Promise<unknown>;
  title: Record<Locale, string>;
}>;

const COMPANY_VALUES: Record<string, string> = {
  COMPANY_NAME: 'Example Trading Co.',
  COMPANY_ADDRESS: 'King Fahd Road, Riyadh',
  COMPANY_CR_NUMBER: '1010000000',
  VAT_NUMBER: '300000000000003',
  CONTACT_EMAIL: 'legal@example.com',
  SUPPORT_EMAIL: 'support@example.com',
};

const ENV_KEYS = Object.values(COMPANY_ENV);
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  mocks.cookies.clear();
  mocks.acceptLanguage = null;
  mocks.draft = true;
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function render(Page: () => ReactElement, locale: Locale): Promise<string> {
  mocks.cookies.set('aivore_locale', locale);
  const element = Page();
  if (!isValidElement(element)) throw new Error('a page returns an element');
  // The pages are server components that return <LegalDocument>, which is async.
  const type = (element as ReactElement<Record<string, unknown>>).type as (
    props: unknown,
  ) => Promise<ReactElement>;
  return renderToStaticMarkup(await type((element as ReactElement).props));
}

const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);

describe.each(PAGES)('/$slug page', ({ slug, Page, metadata, title }) => {
  it.each(['en', 'ar'] as const)(
    'renders (%s) the landmark, the one heading and every section',
    async (locale) => {
      const html = await render(Page, locale);
      expect(html.match(/<main /g)).toHaveLength(1);
      expect(html).toContain('<main id="main-content"');
      expect(html.match(/<h1[ >]/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`<h1[^>]*>${title[locale]}</h1>`));
      const sections = sectionIdsOf(LEGAL_MESSAGE_KEY[slug]).map(anchorOf);
      expect(sections.length).toBeGreaterThanOrEqual(5);
      for (const id of sections) {
        expect(html).toContain(`<section id="${id}" aria-labelledby="${id}-title"`);
        expect(ids(html)).toContain(`${id}-title`);
      }
      expect(html.match(/<h2 /g)).toHaveLength(sections.length);
    },
  );

  it.each(['en', 'ar'] as const)(
    '(%s) has a table of contents whose anchors all resolve',
    async (locale) => {
      const html = await render(Page, locale);
      const sections = sectionIdsOf(LEGAL_MESSAGE_KEY[slug]).map(anchorOf);
      const nav = html.slice(
        html.indexOf('<nav aria-label="' + (locale === 'en' ? 'On this page' : 'في هذه الصفحة')),
      );
      const targets = [...nav.slice(0, nav.indexOf('</nav>')).matchAll(/href="#([^"]+)"/g)].map(
        (match) => match[1],
      );
      expect(targets).toEqual(sections);
      for (const target of targets) expect(ids(html)).toContain(target);
    },
  );

  it('states when it was last updated, in the language of the page', async () => {
    const en = await render(Page, 'en');
    expect(en).toMatch(/<time dateTime="2026-10-08">Last updated October 8, 2026<\/time>/);
    const ar = await render(Page, 'ar');
    expect(ar).toMatch(/<time dateTime="2026-10-08">آخر تحديث: ٨ أكتوبر ٢٠٢٦<\/time>/);
  });

  it.each(['en', 'ar'] as const)(
    '(%s) leaves no token, "undefined" or "NaN" in the text',
    async (locale) => {
      const html = await render(Page, locale);
      expect(html).not.toMatch(/\{[A-Za-z]+\}/);
      expect(html).not.toMatch(/undefined|NaN|\[object/);
    },
  );

  it('links the other three documents and nothing it should not', async () => {
    const html = await render(Page, 'en');
    const others = PAGES.filter((page) => page.slug !== slug);
    for (const other of others) expect(html).toContain(`href="/${other.slug}"`);
    expect(html).not.toMatch(/href="https?:\/\//);
  });

  it('has the right metadata: title, description and a canonical URL', async () => {
    mocks.cookies.set('aivore_locale', 'en');
    const meta = (await metadata()) as {
      title: string;
      description: string;
      alternates: { canonical: string; languages: Record<string, string> };
    };
    expect(meta.title).toBe(title.en);
    expect(meta.description.length).toBeGreaterThan(40);
    expect(meta.alternates.canonical).toBe(`/${slug}`);
    expect(meta.alternates.languages).toEqual({
      ar: `/${slug}`,
      en: `/${slug}`,
      'x-default': `/${slug}`,
    });

    mocks.cookies.set('aivore_locale', 'ar');
    expect(((await metadata()) as { title: string }).title).toBe(title.ar);
  });

  it('is a thin page: it hands its slug to LegalDocument', () => {
    const element = Page() as ReactElement<{ slug: string }>;
    expect(element.type).toBe(LegalDocument);
    expect(element.props.slug).toBe(slug);
  });
});

describe('company details on the pages', () => {
  it('shows a marked placeholder for each detail a page uses while the environment is empty', async () => {
    const terms = await render(TermsPage, 'en');
    for (const field of COMPANY_FIELDS) expect(terms).toContain(`data-placeholder="${field}"`);
    expect(terms).toContain('[Company name: to be provided]');
    expect(terms).toContain('[VAT number: to be provided]');
    expect(terms).toContain('[Commercial registration number: to be provided]');
    expect(terms).toContain('[Company address: to be provided]');
    expect(terms).not.toContain('mailto:');

    const privacy = await render(PrivacyPage, 'en');
    for (const field of ['companyName', 'companyCr', 'companyAddress', 'contactEmail']) {
      expect(privacy).toContain(`data-placeholder="${field}"`);
    }
    expect(await render(RefundsPage, 'en')).toContain('data-placeholder="supportEmail"');
    const aup = await render(AcceptableUsePage, 'en');
    expect(aup).toContain('data-placeholder="contactEmail"');
    expect(aup).toContain('data-placeholder="supportEmail"');
  });

  it('shows the placeholders in Arabic too', async () => {
    const terms = await render(TermsPage, 'ar');
    expect(terms).toContain('[اسم الشركة: يُستكمل لاحقًا]');
    expect(terms).toContain('[الرقم الضريبي: يُستكمل لاحقًا]');
    expect(terms).toContain('[بريد الدعم: يُستكمل لاحقًا]');
  });

  it('shows the real details, and no placeholder, once the environment has them', async () => {
    Object.assign(process.env, COMPANY_VALUES);
    for (const locale of ['en', 'ar'] as const) {
      const terms = await render(TermsPage, locale);
      expect(terms).not.toContain('data-placeholder');
      expect(terms).toContain('Example Trading Co.');
      expect(terms).toContain('1010000000');
      expect(terms).toContain('300000000000003');
      expect(terms).toContain('King Fahd Road, Riyadh');
      expect(terms).toContain('href="mailto:legal@example.com"');
      expect(terms).toContain('href="mailto:support@example.com"');
    }
    expect(await render(PrivacyPage, 'en')).not.toContain('data-placeholder');
    expect(await render(RefundsPage, 'en')).not.toContain('data-placeholder');
    expect(await render(AcceptableUsePage, 'en')).not.toContain('data-placeholder');
  });

  it('never invents a detail: an invalid email stays a placeholder', async () => {
    Object.assign(process.env, COMPANY_VALUES, {
      CONTACT_EMAIL: 'a@example.com?bcc=evil@example.com',
    });
    const html = await render(TermsPage, 'en');
    expect(html).toContain('data-placeholder="contactEmail"');
    expect(html).not.toContain('bcc=');
    expect(html).toContain('href="mailto:support@example.com"');
  });

  it('escapes what the environment says', async () => {
    Object.assign(process.env, COMPANY_VALUES, { COMPANY_NAME: '<script>alert(1)</script>' });
    const html = await render(PrivacyPage, 'en');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('the draft notice', () => {
  it('is on every page by default, in both languages', async () => {
    for (const { Page } of PAGES) {
      const en = await render(Page, 'en');
      expect(en).toContain('data-legal-draft');
      expect(en).toContain('Draft — pending legal review');
      const ar = await render(Page, 'ar');
      expect(ar).toContain('مسودة — بانتظار المراجعة القانونية');
    }
  });

  it('goes away, with the "to confirm" flags, when LEGAL_DRAFT is switched off', async () => {
    mocks.draft = false;
    for (const { Page } of PAGES) {
      for (const locale of ['en', 'ar'] as const) {
        const html = await render(Page, locale);
        expect(html).not.toContain('data-legal-draft');
        expect(html).not.toContain('data-confirm');
        expect(html).not.toContain('pending legal review');
        expect(html).not.toContain('بانتظار المراجعة القانونية');
        expect(html).not.toContain('To confirm');
      }
    }
  });

  it('has "to confirm" flags in the text while it is a draft', async () => {
    const html = await render(TermsPage, 'en');
    expect(html.match(/data-confirm/g)!.length).toBeGreaterThan(10);
  });

  it('does not leave a space in front of the full stop where a flag was', async () => {
    mocks.draft = false;
    const html = await render(TermsPage, 'en');
    expect(html).not.toMatch(/ \./);
    expect(html).not.toMatch(/ ;/);
  });
});

describe('numbers that come from the code, not from the dictionary', () => {
  it('terms: the VAT rate, renewal lead time and grace period of the billing code', async () => {
    const en = await render(TermsPage, 'en');
    expect(en).toContain('value added tax at 15%');
    expect(en).toContain('About 3 days before the end of a paid month');
    expect(en).toContain('pay for 7 more days');
    const ar = await render(TermsPage, 'ar');
    expect(ar).toContain('بنسبة ١٥٪');
    expect(ar).toContain('بنحو ٣ أيام');
    expect(ar).toContain('خلال ٧ أيام إضافية');
  });

  it('refunds: the refund window', async () => {
    const en = await render(RefundsPage, 'en');
    expect(en).toContain('within 7 days if its credits are unused');
    expect(await render(RefundsPage, 'ar')).toContain('خلال ٧ أيام');
  });

  it('follows the VAT rate the operator configured', async () => {
    process.env.VAT_RATE_PERCENT = '5';
    const { resetEnvForTests } = await import('@/server/env');
    resetEnvForTests();
    try {
      expect(await render(TermsPage, 'en')).toContain('value added tax at 5%');
    } finally {
      process.env.VAT_RATE_PERCENT = '15';
      resetEnvForTests();
    }
  });
});
