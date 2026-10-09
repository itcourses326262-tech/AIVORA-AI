import sharp from 'sharp';
import { E2E_LIMITS } from './env';
import { expect, test } from './fixtures';

test.describe('the end-to-end server', () => {
  test('is cut off from every real provider and payment gateway', async ({ request }) => {
    const response = await request.get('/api/v1/models');
    expect(response.status()).toBe(200);
    const { data } = (await response.json()) as {
      data: Array<{ id: string; provider: string; available: boolean; unavailableReason?: string }>;
    };

    const demo = data.filter((model) => model.provider === 'mock');
    expect(demo.map((model) => model.id).sort()).toEqual([
      'aivore-demo-image',
      'aivore-demo-video',
    ]);
    expect(demo.every((model) => model.available)).toBe(true);

    // `.env.local` on a developer machine may hold a real FAL_KEY: the run must not see it.
    const real = data.filter((model) => model.provider !== 'mock');
    expect(real.length).toBeGreaterThan(0);
    for (const model of real) {
      expect(model.available, `${model.id} must be unavailable`).toBe(false);
      expect(model.unavailableReason).toBe('not_configured');
    }

    const billing = await request.get('/api/v1/billing/plans');
    expect(((await billing.json()) as { data: { gateway: string } }).data.gateway).toBe('off');
  });

  test('has rate limits switched off, so parallel tests can share one address', async ({
    api,
    request,
  }) => {
    // The login limit is 10 a minute: twenty wrong passwords in a row must all be plain 401s.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request.post('/api/v1/auth/login', {
        data: { email: `nobody-${attempt}@example.com`, password: 'Wrong-pass-123!' },
        headers: { origin: api.origin },
      });
      statuses.push(response.status());
    }
    expect(statuses.every((status) => status === 401)).toBe(true);
  });

  test('keeps every test on its own account and an empty ledger of its own', async ({
    api,
    account,
  }) => {
    expect(await api.balance()).toBe(50);
    expect(await api.listGenerations()).toEqual([]);
    expect(await api.listKeys()).toEqual([]);
    expect((await api.me())?.id).toBe(account.id);
  });

  test('pins the limits the specs assume, whatever .env.local says', async ({ api, request }) => {
    // Next loads .env.local even in production mode: a value an owner tuned for production must
    // not reach this run. (The active-generation limit is pinned the same way; api.spec uses it.)
    await test.step('the VAT rate in the price list', async () => {
      const response = await request.get('/api/v1/billing/plans');
      const { data } = (await response.json()) as { data: { vatPercent: number } };
      expect(data.vatPercent).toBe(E2E_LIMITS.vatRatePercent);
    });

    await test.step('the largest upload lies between 2 MB and the pinned limit', async () => {
      // Noise does not compress, so this PNG really weighs about 3 MB.
      const picture = await sharp({
        create: {
          width: 1100,
          height: 1100,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
          noise: { type: 'gaussian', mean: 128, sigma: 60 },
        },
      })
        .png({ compressionLevel: 1 })
        .toBuffer();
      expect(picture.byteLength).toBeGreaterThan(2 * 1024 * 1024);
      expect(picture.byteLength).toBeLessThan(E2E_LIMITS.maxUploadMb * 1024 * 1024);
      expect(await api.uploadImage(picture, 'image/png', 'big.png')).toMatch(/^ast_/);

      const tooBig = Buffer.concat([
        picture.subarray(0, 64),
        Buffer.alloc((E2E_LIMITS.maxUploadMb + 0.5) * 1024 * 1024),
      ]);
      const refused = await api.request.post('/api/v1/uploads', {
        multipart: { file: { name: 'huge.png', mimeType: 'image/png', buffer: tooBig } },
        headers: { origin: api.origin },
      });
      expect(refused.status()).toBe(413);
    });
  });
});
