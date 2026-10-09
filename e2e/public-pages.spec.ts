import { mockCheckoutMessages } from '@/lib/billing/mock-checkout-messages';
import { LEGAL_DRAFT } from '@/lib/legal';
import { expect, test } from './fixtures';
import { insertMockOrder } from './fixtures/database';
import { en } from './fixtures/i18n';

const LEGAL_PAGES = [
  { path: '/terms', heading: 'Terms of Service' },
  { path: '/privacy', heading: 'Privacy Policy' },
  { path: '/refunds', heading: 'Refund Policy' },
  { path: '/acceptable-use', heading: 'Acceptable Use Policy' },
] as const;

test.describe('public pages', () => {
  test('the landing page explains the product and leads to sign-up', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/AIVORE/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Imagine it in words. Watch it come alive.' }),
    ).toBeVisible();

    await test.step('the header and footer carry the main routes', async () => {
      const nav = page.getByRole('navigation', { name: en('common.a11y.mainNavigation') });
      await expect(nav.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore');
      await expect(nav.getByRole('link', { name: /docs/i })).toHaveAttribute('href', '/docs');
      await expect(page.getByRole('link', { name: 'Log in' }).first()).toHaveAttribute(
        'href',
        '/login',
      );
      const footer = page.getByRole('contentinfo');
      for (const { path } of LEGAL_PAGES) {
        await expect(footer.locator(`a[href="${path}"]`)).toBeVisible();
      }
    });

    await test.step('the call to action starts the registration', async () => {
      await page
        .getByRole('link', { name: en('landing.hero.cta') })
        .first()
        .click();
      await expect(page).toHaveURL(/\/register/);
      await expect(
        page.getByRole('heading', { level: 1, name: en('auth.register.title') }),
      ).toBeVisible();
    });
  });

  test('the landing page names a language: Arabic by default, English when asked', async ({
    request,
  }) => {
    const none = await request.get('/', { headers: { 'accept-language': '' } });
    expect(await none.text()).toMatch(/<html lang="ar" dir="rtl"/);
    const english = await request.get('/', { headers: { 'accept-language': 'en-GB,en;q=0.8' } });
    expect(await english.text()).toMatch(/<html lang="en" dir="ltr"/);
    const cookie = await request.get('/', {
      headers: { 'accept-language': 'en', cookie: 'aivore_locale=ar' },
    });
    expect(await cookie.text()).toMatch(/<html lang="ar" dir="rtl"/);
  });

  test('without payment keys the pricing page says buying is paused and nothing can be bought', async ({
    page,
    api,
  }) => {
    await test.step('the public price list reports the gateway as off', async () => {
      const catalog = await page.request.get('/api/v1/billing/plans');
      expect(catalog.status()).toBe(200);
      const body = (await catalog.json()) as {
        data: {
          gateway: string;
          canPurchase: boolean;
          currency: string;
          packs: unknown[];
          plans: unknown[];
        };
      };
      expect(body.data).toMatchObject({ gateway: 'off', canPurchase: false, currency: 'SAR' });
      expect(body.data.packs.length).toBeGreaterThan(0);
      expect(body.data.plans.length).toBeGreaterThan(0);
    });

    await test.step('the page shows the paused notice and no "test payments" notice', async () => {
      await page.goto('/pricing');
      await expect(
        page.getByRole('heading', { level: 1, name: en('billing.pricing.hero.title') }),
      ).toBeVisible();
      const notice = page.getByRole('note').filter({ hasText: 'Buying is paused' });
      await expect(notice).toContainText('Buying credits is not available right now.');
      await expect(page.getByText(en('billing.pricing.notice.mockTitle'))).toHaveCount(0);
      await expect(page.getByRole('article', { name: 'Starter' })).toContainText('SAR 49');
    });

    await test.step('every buy button is disabled', async () => {
      const buttons = page.getByRole('button', { name: en('billing.cta.unavailable') });
      await expect(buttons).toHaveCount(3);
      for (const button of await buttons.all()) await expect(button).toBeDisabled();
      await page.getByRole('radio', { name: en('billing.pricing.mode.packs') }).click();
      await expect(page.getByRole('button', { name: en('billing.cta.unavailable') })).toHaveCount(
        3,
      );
    });

    await test.step('the server refuses a checkout too, with a 503 and nothing stored', async () => {
      const checkout = await page.request.post('/api/v1/billing/checkout', {
        data: { type: 'pack', id: 'pack-500' },
        headers: { origin: api.origin, 'idempotency-key': crypto.randomUUID() },
      });
      expect(checkout.status()).toBe(503);
      expect(
        ((await checkout.json()) as { error: { details: { reason: string } } }).error.details
          .reason,
      ).toBe('billing_disabled');
      const orders = await page.request.get('/api/v1/billing/orders');
      expect(((await orders.json()) as { data: unknown[] }).data).toEqual([]);
    });
  });

  test.describe('signed in', () => {
    test.use({ signedIn: true });

    test('the fake checkout page does not exist in production, not even for a real fake-gateway order', async ({
      page,
      account,
      api,
    }) => {
      // The server cannot create such an order here, so one is written into the scratch database:
      // without it every URL below would answer 404 simply because there is nothing to show.
      const orderId = insertMockOrder(account.id);

      await test.step("control: the order exists and is the signed-in account's own", async () => {
        const orders = await api.request.get('/api/v1/billing/orders');
        expect(orders.status()).toBe(200);
        const listed = ((await orders.json()) as { data: Array<{ id: string; status: string }> })
          .data;
        expect(listed.map((order) => order.id)).toContain(orderId);
      });

      await test.step('its payment page is a 404 anyway, as are malformed and unknown ids', async () => {
        for (const path of [
          `/billing/mock-checkout/${orderId}`,
          '/billing/mock-checkout/ord_00000000000000000000000000',
          '/billing/mock-checkout/anything',
        ]) {
          const response = await page.goto(path);
          expect(response?.status(), path).toBe(404);
          await expect(
            page.getByRole('heading', { name: mockCheckoutMessages.en.heading }),
            path,
          ).toHaveCount(0);
        }
      });

      await test.step('the gateway webhook is closed as well', async () => {
        const hook = await page.request.post('/api/v1/billing/webhooks/moyasar', {
          data: { id: 'x' },
        });
        expect(hook.status()).toBe(503);
      });
    });
  });

  test.describe('billing pages with payments switched off', () => {
    test.use({ signedIn: true });

    test('Billing shows the balance and an honest empty state, and the return page copes with nothing to show', async ({
      page,
    }) => {
      await page.goto('/account/billing');
      await expect(page.getByRole('heading', { level: 1, name: 'Billing & plans' })).toBeVisible();
      await expect(page.getByText('50 credits')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: en('billing.account.plan.none.title') }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: en('billing.account.orders.empty.title') }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: en('billing.account.balance.buy') }),
      ).toHaveAttribute('href', '/pricing');

      await page.goto('/billing/return');
      await expect(
        page.getByRole('heading', { level: 1, name: en('billing.return.missing.title') }),
      ).toBeVisible();
      await page.goto('/billing/return?order=ord_00000000000000000000000000');
      await expect(
        page.getByRole('heading', { level: 1, name: en('billing.return.notFound.title') }),
      ).toBeVisible();
      await page.goto('/billing/return?order=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
      await expect(
        page.getByRole('heading', { level: 1, name: en('billing.return.notFound.title') }),
      ).toBeVisible();
    });
  });

  for (const { path, heading } of LEGAL_PAGES) {
    test(`${path} is public, readable and marked as a draft while LEGAL_DRAFT is on`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      // `LEGAL_DRAFT` (src/lib/legal.ts) is the owner's switch once a lawyer has approved the
      // texts: the note must follow it in both directions, so launching does not break this test.
      const note = page.getByRole('note', { name: en('legal.common.draft.title') });
      if (LEGAL_DRAFT) await expect(note).toBeVisible();
      else await expect(note).toHaveCount(0);
      await expect(page.locator('main time').first()).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'On this page' }).first()).toBeAttached();
      expect(await page.locator('h2').count()).toBeGreaterThan(5);
    });
  }

  test('the terms link on the registration form opens the terms in a new tab', async ({
    page,
    context,
  }) => {
    await page.goto('/register');
    const opened = context.waitForEvent('page');
    await page.getByRole('link', { name: /^Terms of Service/ }).click();
    const terms = await opened;
    await terms.waitForLoadState();
    await expect(terms).toHaveURL(/\/terms$/);
    await expect(page).toHaveURL(/\/register$/);
  });

  test('the API documentation lists every operation of the OpenAPI document', async ({
    page,
    request,
  }) => {
    const spec = (await (await request.get('/api/v1/openapi.json')).json()) as OpenApiDocument;
    const operations = Object.values(spec.paths).flatMap((methods) =>
      Object.entries(methods)
        .filter(([method]) => HTTP_METHODS.has(method))
        .map(([, operation]) => operation.summary),
    );
    expect(operations.length).toBeGreaterThan(25);

    await page.goto('/docs');
    await expect(
      page.getByRole('heading', { level: 1, name: en('account.docs.hero.title') }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Quickstart' })).toBeVisible();
    const text = await page.locator('main').innerText();
    for (const summary of operations) {
      expect(text, `docs mention "${summary}"`).toContain(summary);
    }
  });

  test('the docs code language choice is remembered on the device', async ({ page }) => {
    await page.goto('/docs');
    const language = (name: string) => page.getByRole('radio', { name }).first();
    const createExample = (name: string) =>
      page.getByRole('region', { name: `Create a generation · ${name}` });

    await expect(language('cURL')).toBeChecked();
    await expect(createExample('cURL')).toContainText('curl');

    await language('JavaScript').click();
    await expect(createExample('JavaScript')).toContainText('await api(');

    await page.reload();
    await expect(language('JavaScript')).toBeChecked();
    await expect(createExample('JavaScript')).toContainText('await api(');
  });

  test('an unknown address is a friendly 404 with a way home, in both languages', async ({
    page,
  }) => {
    const response = await page.goto('/definitely-not-a-page');
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: en('landing.status.notFound.title') }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/stack|exception|digest|node_modules/i);
    await page.getByRole('link', { name: /home/i }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('machine-readable endpoints', () => {
  test('robots.txt allows the public site, keeps crawlers out of the app and names the sitemap', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^text\/plain/);
    const text = await response.text();
    expect(text).toContain('User-Agent: *');
    expect(text).toContain('Allow: /');
    expect(text).toContain('Allow: /api/v1/media/');
    for (const hidden of ['/api/', '/studio', '/gallery', '/account']) {
      expect(text).toContain(`Disallow: ${hidden}`);
    }
    expect(text).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
  });

  test('sitemap.xml lists only pages that exist', async ({ request, baseURL }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/xml/);
    const xml = await response.text();
    expect(xml).toMatch(/^<\?xml/);
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '');
    expect(locations.length).toBeGreaterThanOrEqual(8);
    for (const required of [
      '/',
      '/explore',
      '/pricing',
      '/docs',
      '/terms',
      '/privacy',
      '/refunds',
      '/acceptable-use',
    ]) {
      expect(locations).toContain(`${baseURL}${required === '/' ? '/' : required}`);
    }
    for (const location of locations) {
      expect(location.startsWith(`${baseURL}/`)).toBe(true);
      expect((await request.get(location)).status(), location).toBe(200);
    }
    for (const hidden of ['/studio', '/gallery', '/account', '/login']) {
      expect(locations).not.toContain(`${baseURL}${hidden}`);
    }
  });

  test('the OpenAPI document is a coherent 3.1 description of this deployment', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get('/api/v1/openapi.json');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^application\/json/);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    const spec = (await response.json()) as OpenApiDocument;

    expect(spec.openapi).toMatch(/^3\.1\.\d+$/);
    expect(spec.info.title).toMatch(/AIVORE/);
    expect(spec.info.version).toMatch(/^\d+\.\d+/);
    expect(spec.servers?.[0]?.url).toBe(`${baseURL}/api/v1`);
    expect(Object.keys(spec.components?.securitySchemes ?? {}).sort()).toEqual([
      'bearerAuth',
      'cookieAuth',
    ]);
    for (const path of [
      '/generations',
      '/generations/{id}',
      '/models',
      '/keys',
      '/account',
      '/explore',
    ]) {
      expect(spec.paths, path).toHaveProperty([path]);
    }

    await test.step('every operation has an id, a summary and responses, and ids are unique', async () => {
      const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
        Object.entries(methods)
          .filter(([method]) => HTTP_METHODS.has(method))
          .map(([method, operation]) => ({ path, method, operation })),
      );
      expect(operations.length).toBeGreaterThanOrEqual(30);
      const ids = operations.map(({ operation }) => operation.operationId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const { path, method, operation } of operations) {
        expect(operation.summary, `${method} ${path} summary`).toBeTruthy();
        expect(
          Object.keys(operation.responses ?? {}).length,
          `${method} ${path} responses`,
        ).toBeGreaterThan(0);
      }
    });

    await test.step('every $ref points at something that exists in the document', async () => {
      const unresolved: string[] = [];
      const visit = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (node === null || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
          if (key === '$ref' && typeof value === 'string' && !resolvePointer(spec, value))
            unresolved.push(value);
          else visit(value);
        }
      };
      visit(spec);
      expect(unresolved).toEqual([]);
    });

    await test.step('it is cacheable: a strong ETag and a 304 for the same version', async () => {
      const etag = response.headers().etag;
      expect(etag).toMatch(/^"/);
      const again = await request.get('/api/v1/openapi.json', {
        headers: { 'if-none-match': etag ?? '' },
      });
      expect(again.status()).toBe(304);
    });
  });

  test('the health endpoint reports a working database and the worker mode', async ({
    request,
  }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'ok',
      db: true,
      worker: 'inline',
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
  });

  test('the web app manifest and icons are served', async ({ request }) => {
    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.status()).toBe(200);
    const body = (await manifest.json()) as {
      name: string;
      start_url: string;
      icons: Array<{ src: string }>;
    };
    expect(body.name).toBe('AIVORE');
    expect(body.icons.length).toBeGreaterThan(0);
    for (const icon of body.icons) {
      expect((await request.get(icon.src)).status(), icon.src).toBe(200);
    }
    for (const path of ['/favicon.ico', '/icon.svg', '/apple-icon.png', '/opengraph-image.png']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(Number(response.headers()['content-length'] ?? '1')).toBeGreaterThan(0);
    }
  });
});

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  responses?: Record<string, unknown>;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  servers?: Array<{ url: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { securitySchemes?: Record<string, unknown> };
}

/** Follows a local `#/a/b/c` JSON pointer. */
function resolvePointer(document: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = document;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !(key in node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}
