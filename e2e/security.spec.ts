import type { APIResponse } from '@playwright/test';
import { E2E_SESSION_SECRET } from './env';
import { expect, test } from './fixtures';
import { createDemoImage } from './fixtures/api';
import { TEST_PASSWORD } from './fixtures/users';

/**
 * The e2e server's own secret: it must never appear in anything it sends. It is the very constant
 * the server is started with (`e2e/env.ts`, used by `playwright.config.ts`), so rotating it there
 * cannot leave this spec searching for a string that is no longer the secret.
 */
const SESSION_SECRET = E2E_SESSION_SECRET;

/** Built at run time so this file holds no key-shaped literal (tests/security/no-secret-literals.test.ts). */
const SECRET_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ['payment key', new RegExp('\\b[sp]k_(?:live|test)_' + '[A-Za-z0-9]{8,}')],
  ['AWS access key', new RegExp('\\bAK' + 'IA[0-9A-Z]{16}\\b')],
  ['private key block', new RegExp('-----BEGIN [A-Z ]*PRIV' + 'ATE KEY-----')],
  ['OpenAI-style key', new RegExp('\\bsk-' + '[A-Za-z0-9_-]{32,}')],
  ['fal key', new RegExp('\\bfal_' + 'sk_[A-Za-z0-9]{8,}')],
];

/** What an error answer must never contain: stack frames, file paths, driver or secret names. */
const INTERNALS: ReadonlyArray<[string, RegExp]> = [
  ['stack frame', /\n\s+at\s+[\w.<>$ ]+\s\(.*:\d+:\d+\)/],
  ['node_modules path', /node_modules/],
  ['source path', /\/home\/|\/src\/(?:app|server|lib)\//],
  ['database internals', /better-sqlite3|SQLITE_|drizzle/i],
  [
    'environment variable name',
    /SESSION_SECRET|FAL_KEY|MOYASAR_SECRET_KEY|OPENAI_API_KEY|DATABASE_PATH/,
  ],
  ['the secret itself', new RegExp(SESSION_SECRET)],
];

function expectClean(text: string, label: string): void {
  for (const [name, shape] of [...SECRET_SHAPES, ...INTERNALS]) {
    expect(shape.test(text), `${label} must not contain a ${name}`).toBe(false);
  }
}

function header(response: APIResponse, name: string): string {
  return response.headers()[name] ?? '';
}

test.describe('security headers', () => {
  const documents = ['/', '/login', '/pricing', '/docs', '/explore', '/does-not-exist'];

  for (const path of documents) {
    test(`${path} sends the hardening headers`, async ({ request }) => {
      const response = await request.get(path);
      const csp = header(response, 'content-security-policy');

      for (const directive of [
        "default-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "frame-src 'none'",
        "connect-src 'self'",
      ]) {
        expect(csp, `CSP of ${path}`).toContain(directive);
      }
      // Production never needs eval, and nothing may load script from another origin.
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp.match(/script-src[^;]*/)?.[0]).toBe("script-src 'self' 'unsafe-inline'");

      expect(header(response, 'x-content-type-options')).toBe('nosniff');
      expect(header(response, 'x-frame-options')).toBe('DENY');
      expect(header(response, 'referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(header(response, 'cross-origin-opener-policy')).toBe('same-origin');
      expect(header(response, 'strict-transport-security')).toMatch(/max-age=\d{7,}/);
      expect(header(response, 'permissions-policy')).toContain('camera=()');
      expect(header(response, 'permissions-policy')).toContain('microphone=()');
      expect(header(response, 'permissions-policy')).toContain('geolocation=()');
      expect(response.headers()['x-powered-by']).toBeUndefined();
    });
  }

  test('API answers and media carry the headers, are never cached by shared caches, and never sniffed', async ({
    api,
  }) => {
    const created = await createDemoImage(api, 'Header check');
    const picture = created.outputs[0]?.url ?? '';

    const json = await api.request.get('/api/v1/models');
    expect(header(json, 'x-content-type-options')).toBe('nosniff');
    expect(header(json, 'content-security-policy')).toContain("default-src 'self'");
    expect(header(json, 'x-request-id')).toMatch(/\S/);

    const account = await api.request.get('/api/v1/account');
    expect(header(account, 'cache-control')).toContain('no-store');

    const media = await api.request.get(picture);
    expect(media.status()).toBe(200);
    expect(header(media, 'x-content-type-options')).toBe('nosniff');
    expect(header(media, 'content-type')).toBe('image/webp');
    expect(header(media, 'cache-control')).toMatch(/^private/);
    expect(header(media, 'content-security-policy')).toContain("default-src 'self'");
  });

  test('the session cookie is HttpOnly, Secure, SameSite=Lax and site-wide', async ({
    playwright,
    baseURL,
  }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      const email = `e2e-cookie-${crypto.randomUUID().slice(0, 8)}@example.com`;
      const response = await anonymous.post('/api/v1/auth/register', {
        data: { name: 'Cookie Check', email, password: TEST_PASSWORD, locale: 'en' },
        headers: { origin: baseURL ?? '' },
      });
      expect(response.status()).toBe(201);
      const cookies = response
        .headersArray()
        .filter((entry) => entry.name.toLowerCase() === 'set-cookie');
      const session =
        cookies.find((entry) => entry.value.startsWith('aivore_session='))?.value ?? '';
      expect(session).toMatch(/;\s*HttpOnly/i);
      expect(session).toMatch(/;\s*Secure/i);
      expect(session).toMatch(/;\s*SameSite=Lax/i);
      expect(session).toMatch(/;\s*Path=\//i);
      expect(session).toMatch(/;\s*(Max-Age|Expires)=/i);
      expect(JSON.stringify(await response.json())).not.toMatch(/passwordHash|scrypt\$|"password"/);
    } finally {
      await anonymous.dispose();
    }
  });
});

test.describe('content security policy in the browser', () => {
  // The page logs every refusal: that log is the proof the policy works, not a defect.
  test.use({ expectedConsoleErrors: [/Content Security Policy/] });

  test('the browser really enforces the policy: other origins are refused for requests and pictures', async ({
    page,
  }) => {
    await page.goto('/login');
    const violations = await page.evaluate(async () => {
      const seen: string[] = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        seen.push(event.violatedDirective),
      );
      const outcome = await fetch('https://example.invalid/collect', { mode: 'no-cors' }).then(
        () => 'sent',
        () => 'blocked',
      );
      const image = new Image();
      image.src = 'https://example.invalid/pixel.png';
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { outcome, seen };
    });
    expect(violations.outcome).toBe('blocked');
    expect(violations.seen).toEqual(expect.arrayContaining(['connect-src', 'img-src']));
  });
});

test.describe('cross-site requests are refused', () => {
  test('login, logout and every cookie-authenticated change check the Origin', async ({
    account,
    api,
    request,
    baseURL,
  }) => {
    const foreign = { origin: 'https://evil.example' };

    await test.step('login from another site is a 403 and sets no cookie', async () => {
      const response = await request.post('/api/v1/auth/login', {
        data: { email: account.email, password: account.password },
        headers: foreign,
      });
      expect(response.status()).toBe(403);
      expect(response.headers()['set-cookie']).toBeUndefined();
    });

    await test.step('a signed-in browser session cannot be driven from another site', async () => {
      const attempts: Array<[string, string, unknown]> = [
        [
          'POST',
          '/api/v1/generations',
          { tool: 'text-to-image', modelId: 'aivore-demo-image', prompt: 'x' },
        ],
        ['POST', '/api/v1/keys', { name: 'stolen' }],
        ['PATCH', '/api/v1/account', { name: 'Hijacked' }],
        [
          'POST',
          '/api/v1/account/password',
          { currentPassword: account.password, newPassword: 'Hijacked-pass-1!' },
        ],
        ['POST', '/api/v1/auth/logout', undefined],
      ];
      for (const [method, path, data] of attempts) {
        const response = await api.request.fetch(path, {
          method,
          headers: { ...foreign, 'idempotency-key': crypto.randomUUID() },
          ...(data === undefined ? {} : { data }),
        });
        expect(response.status(), `${method} ${path} from another site`).toBe(403);
      }
      // …and a request with no Origin or Referer at all is refused as well.
      const bare = await api.request.fetch('/api/v1/keys', { method: 'POST', data: { name: 'x' } });
      expect(bare.status()).toBe(403);
    });

    await test.step('nothing changed', async () => {
      expect((await api.me())?.name).toBe(account.name);
      expect(await api.listKeys()).toEqual([]);
      expect(await api.listGenerations()).toEqual([]);
      expect(await api.statusOf('GET', '/api/v1/auth/me')).toBe(200);
      expect(baseURL).toBeTruthy();
    });
  });
});

test.describe('errors leak nothing', () => {
  test('API errors are the standard envelope without internals', async ({
    api,
    request,
    playwright,
    baseURL,
  }) => {
    const probes: Array<{ label: string; run: () => Promise<APIResponse>; status: number }> = [
      {
        label: 'unknown route',
        run: () => request.get('/api/v1/definitely-not-a-route'),
        status: 404,
      },
      { label: 'unauthenticated read', run: () => request.get('/api/v1/generations'), status: 401 },
      {
        label: 'malformed JSON',
        run: () =>
          api.request.post('/api/v1/generations', {
            data: Buffer.from('{"tool": '),
            headers: { origin: api.origin, 'content-type': 'application/json' },
          }),
        status: 400,
      },
      {
        label: 'invalid body',
        run: () =>
          api.request.post('/api/v1/generations', {
            data: { tool: 'nope', modelId: 42, prompt: '' },
            headers: { origin: api.origin, 'idempotency-key': crypto.randomUUID() },
          }),
        status: 422,
      },
      {
        label: 'malformed id',
        run: () => api.request.get("/api/v1/generations/x'; DROP TABLE users;--"),
        status: 404,
      },
      {
        label: 'unknown media id',
        run: () => api.request.get('/api/v1/media/ast_00000000000000000000000000'),
        status: 404,
      },
      {
        label: 'oversized body',
        run: () =>
          api.request.post('/api/v1/auth/login', {
            data: { email: 'a@example.com', password: 'x'.repeat(20_000) },
            headers: { origin: api.origin },
          }),
        status: 413,
      },
      {
        label: 'wrong method',
        run: () =>
          api.request.fetch('/api/v1/models', {
            method: 'DELETE',
            headers: { origin: api.origin },
          }),
        status: 405,
      },
    ];

    for (const probe of probes) {
      const response = await probe.run();
      const text = await response.text();
      expect(response.status(), probe.label).toBe(probe.status);
      expectClean(text, probe.label);
      if (response.headers()['content-type']?.includes('json') && probe.status !== 405) {
        const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
        expect(body.error?.code, probe.label).toMatch(/^[a-z_]+$/);
        expect(body.error?.message, probe.label).toBeTruthy();
      }
    }
    expect(playwright).toBeDefined();
    expect(baseURL).toBeTruthy();
  });

  test.describe('signed in', () => {
    test.use({ signedIn: true });

    test('HTML error pages show a friendly page, not a trace', async ({ page }) => {
      for (const path of [
        '/does-not-exist',
        '/s/not-a-real-id',
        '/gallery/not-a-real-id',
        '/gallery/gen_00000000000000000000000000',
      ]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
        const html = await page.content();
        expectClean(html, path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      }
    });
  });

  test('pages, data payloads and scripts never contain a secret', async ({ page, api }) => {
    const created = await createDemoImage(api, 'Secret scan');
    await api.patchGeneration(created.id, { isPublic: true });
    await api.createKey('scan key');

    const bodies: Array<{ url: string; text: string }> = [];
    page.on('response', async (response) => {
      const type = response.headers()['content-type'] ?? '';
      if (/javascript|json|html|text|xml/.test(type)) {
        bodies.push({ url: response.url(), text: await response.text().catch(() => '') });
      }
    });

    for (const path of [
      '/',
      '/studio',
      '/gallery',
      '/account?tab=keys',
      '/account?tab=data',
      `/s/${created.id}`,
      '/explore',
      '/pricing',
      '/docs',
    ]) {
      await page.goto(path);
      await expect(page.locator('main#main-content')).toBeVisible();
      await page.waitForLoadState('networkidle');
    }

    expect(
      bodies.some(({ url }) => /\/_next\/static\/.*\.js/.test(url)),
      'client scripts were inspected',
    ).toBe(true);
    expect(bodies.length).toBeGreaterThan(20);
    for (const { url, text } of bodies) {
      for (const [name, shape] of [
        ...SECRET_SHAPES,
        ['the secret itself', new RegExp(SESSION_SECRET)] as const,
      ]) {
        expect(shape.test(text), `${new URL(url).pathname} must not contain a ${name}`).toBe(false);
      }
    }
    // The only key ever shown in a page is the prefix of the user's own key, never the secret half.
    const keys = await api.listKeys();
    expect(keys).toHaveLength(1);
  });
});
