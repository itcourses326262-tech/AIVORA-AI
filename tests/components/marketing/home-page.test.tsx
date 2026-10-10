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

import HomePage, { generateMetadata } from '@/app/(marketing)/page';
import { resetEnvForTests } from '@/server/env';

async function render(locale: 'ar' | 'en' = 'en') {
  mocks.cookies.set('aivore_locale', locale);
  return renderToStaticMarkup(await HomePage());
}

const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);

beforeEach(() => {
  mocks.cookies.clear();
  mocks.acceptLanguage = null;
});

/** Google sign-in set up: the only situation in which the pages advertise the free credits. */
function withGoogle() {
  process.env.FIREBASE_API_KEY = 'k'.repeat(30);
  process.env.FIREBASE_AUTH_DOMAIN = 'demo-project.firebaseapp.com';
  process.env.FIREBASE_PROJECT_ID = 'demo-project';
  resetEnvForTests();
}

afterEach(() => {
  delete process.env.FIREBASE_API_KEY;
  delete process.env.FIREBASE_AUTH_DOMAIN;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.SIGNUP_BONUS_CREDITS;
  process.env.SIGNUP_BONUS_CREDITS = '50';
  // The suite default (tests/setup.ts): password accounts earn the credits too.
  process.env.SIGNUP_BONUS_PROVIDER = 'any';
  resetEnvForTests();
});

describe('landing page', () => {
  it('renders the page landmark once, with one h1', async () => {
    const html = await render();
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html).toContain('<main id="main-content"');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it('has every section of the brief, each labelled by its own heading', async () => {
    const html = await render();
    const sections = [...html.matchAll(/<section id="([^"]+)" aria-labelledby="([^"]+)"/g)];
    expect(sections.map((section) => section[1])).toEqual([
      'showcase',
      'features',
      'how-it-works',
      'credits',
      'api',
      'faq',
    ]);
    for (const [, id, labelledBy] of sections) {
      expect(labelledBy).toBe(`${id}-title`);
      expect(ids(html)).toContain(labelledBy);
    }
    // The hero and the closing call to action are labelled regions too.
    expect(ids(html)).toEqual(expect.arrayContaining(['hero-title', 'final-cta-title']));
  });

  it('keeps every anchor of the page navigation pointed at an element that exists', async () => {
    const html = await render();
    const nav = html.slice(html.indexOf('<nav aria-label="On this page"'));
    const targets = [...nav.slice(0, nav.indexOf('</nav>')).matchAll(/href="#([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(targets).toEqual(['features', 'how-it-works', 'credits', 'api', 'faq']);
    for (const target of targets) expect(ids(html)).toContain(target);
  });

  it('invites visitors to sign up and to explore, and says what a sign-up is worth', async () => {
    withGoogle();
    const html = await render();
    expect(html).toMatch(/<a [^>]*href="\/register"[^>]*>Start creating free/);
    expect(html).toMatch(/<a [^>]*href="\/explore"[^>]*>Explore creations/);
    expect(html).toContain('Sign up with Google and get 50 credits free. No card needed.');
  });

  it('shows the sign-up bonus from the environment, and leaves the number out when there is none', async () => {
    withGoogle();
    process.env.SIGNUP_BONUS_CREDITS = '120';
    resetEnvForTests();
    expect(await render()).toContain('Sign up with Google and get 120 credits free.');

    process.env.SIGNUP_BONUS_CREDITS = '0';
    resetEnvForTests();
    const none = await render();
    expect(none).toContain('Sign up in seconds. No card needed.');
    expect(none).not.toContain('Free to start');
    expect(none).not.toContain('with Google');
  });

  it('promises the free credits only where they can be earned', async () => {
    // The product policy and no Google sign-in: nobody can earn them, so the page says nothing.
    process.env.SIGNUP_BONUS_PROVIDER = 'google';
    resetEnvForTests();
    const closed = await render();
    expect(closed).toContain('Sign up in seconds. No card needed.');
    expect(closed).not.toContain('Free to start');
    expect(closed).not.toContain('with Google');
    // The description every search result and share card shows cannot depend on the setup, so it
    // promises no credits at all.
    expect(closed).not.toMatch(/credits on sign-up|free credits/i);

    process.env.FIREBASE_API_KEY = 'k'.repeat(30);
    process.env.FIREBASE_AUTH_DOMAIN = 'demo-project.firebaseapp.com';
    process.env.FIREBASE_PROJECT_ID = 'demo-project';
    resetEnvForTests();
    try {
      const open = await render();
      expect(open).toContain('Sign up with Google and get 50 credits free. No card needed.');
      expect(open).toContain('Free to start');
      expect(open).toContain('Sign up with Google and get');
      expect(await render('ar')).toContain('سجّل عبر Google واحصل على ٥٠ رصيدًا مجانًا.');
    } finally {
      delete process.env.FIREBASE_API_KEY;
      delete process.env.FIREBASE_AUTH_DOMAIN;
      delete process.env.FIREBASE_PROJECT_ID;
    }
  });

  it('answers in Arabic, right to left, with Arabic digits and grammar', async () => {
    withGoogle();
    const html = await render('ar');
    expect(html).toContain('ابدأ الإبداع مجانًا');
    expect(html).toContain('٥٠ رصيدًا');
    expect(html).not.toContain('Start creating free');
  });

  it('lists six FAQ answers as native disclosure widgets sharing one name, the first open', async () => {
    const html = await render();
    const details = [...html.matchAll(/<details ([^>]*)>/g)].map((match) => match[1] ?? '');
    expect(details).toHaveLength(6);
    expect(details.every((attributes) => attributes.includes('name="faq"'))).toBe(true);
    expect(details.filter((attributes) => /\bopen=""/.test(attributes))).toHaveLength(1);
    expect(details[0]).toMatch(/\bopen=""/);
    expect(html.match(/<summary [^>]*><h3/g)).toHaveLength(6);
  });

  it('shows seven decorative samples, three of them videos, with the artwork hidden from assistive technology', async () => {
    const html = await render();
    expect(html.match(/<figure /g)).toHaveLength(7);
    expect(
      html.match(/<svg[^>]*viewBox="0 0 (?:400 400|300 560|600 300)"[^>]*aria-hidden="true"/g),
    ).toHaveLength(7);
    expect(html.match(/(?:Text|Image) to video: /g)).toHaveLength(3);
  });

  it('prices the credits section from the catalog', async () => {
    const html = await render();
    expect(html).toContain('FLUX.1 Schnell');
    expect(html).toContain('1 credit');
    expect(html).toMatch(/\d+ credits/);
  });

  it('embeds a left-to-right copyable cURL in the developer section', async () => {
    const html = await render('ar');
    const api = html.slice(html.indexOf('id="api"'), html.indexOf('id="faq"'));
    expect(api).toContain('dir="ltr"');
    expect(api).toContain('curl');
    expect(api).toContain('/api/v1/generations');
    expect(api).toContain('نسخ الأمر');
  });

  it('embeds structured data that parses', async () => {
    const html = await render();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
      (match) => JSON.parse(match[1] ?? '') as { '@type': string },
    );
    expect(blocks.map((block) => block['@type'])).toEqual(['SoftwareApplication', 'FAQPage']);
  });
});

describe('landing metadata', () => {
  const parent = async () => ({ openGraph: { images: [{ url: '/og.png' }] } });

  it('is resolved per request language and keeps the inherited share image', async () => {
    mocks.acceptLanguage = 'en-US';
    const english = await generateMetadata(undefined, parent() as never);
    expect(english.title).toEqual({
      absolute: 'AIVORE: AI images and video from Arabic or English prompts',
    });
    expect(english.openGraph).toMatchObject({ locale: 'en_US', images: [{ url: '/og.png' }] });

    mocks.acceptLanguage = null;
    const arabic = await generateMetadata(undefined, parent() as never);
    expect(arabic.openGraph).toMatchObject({ locale: 'ar_AR' });
  });
});
