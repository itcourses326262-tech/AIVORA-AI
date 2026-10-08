import type * as CatalogModule from '@/lib/catalog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelDTO } from '@/lib/api-types';
import type { ModelSpec } from '@/lib/catalog/types';
import { resetEnvForTests } from '@/server/env';
import { setProviderOverrides } from '@/server/providers/registry';
import { InMemoryRateLimiter, setRateLimiter } from '@/server/security/rate-limit';
import { fakeProvider } from '../../../../helpers/fakes';
import { invokeRoute } from '../../../../helpers/http';
import { fixtureModels } from '../../../../lib/validation/fixtures';

const catalog = vi.hoisted(() => ({ override: undefined as ModelSpec[] | undefined }));
vi.mock('@/lib/catalog', async (importOriginal) => {
  const original = await importOriginal<typeof CatalogModule>();
  return { ...original, getModels: () => catalog.override ?? original.getModels() };
});

const auth = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('@/server/auth', () => ({ authenticate: auth.authenticate }));

import { GET } from '@/app/api/v1/models/route';

const demo = (id: string, kind: 'image' | 'video', label: string): ModelSpec => {
  const base = kind === 'image' ? fixtureModels[0] : fixtureModels[2];
  return { ...(base as ModelSpec), id, provider: 'mock', providerModel: `demo/${id}`, label };
};

// Available: fal (configured). Not available: openai, replicate. mock follows ENABLE_MOCK_PROVIDER.
const models: ModelSpec[] = [
  { ...(fixtureModels[2] as ModelSpec), id: 'z-video', provider: 'fal', label: 'Zed video' },
  { ...(fixtureModels[0] as ModelSpec), id: 'b-image', provider: 'openai', label: 'bravo image' },
  { ...(fixtureModels[0] as ModelSpec), id: 'a-image', provider: 'fal', label: 'Alpha image' },
  {
    ...(fixtureModels[2] as ModelSpec),
    id: 'y-video',
    provider: 'replicate',
    label: 'Yankee video',
  },
  { ...(fixtureModels[0] as ModelSpec), id: 'c-image', provider: 'fal', label: 'Charlie image' },
  demo('demo-image', 'image', 'Demo image'),
  demo('demo-video', 'video', 'Demo video'),
];

function useProviders() {
  setProviderOverrides({
    mock: fakeProvider({ id: 'mock', configured: (env) => env.ENABLE_MOCK_PROVIDER }),
    fal: fakeProvider({ id: 'fal', configured: true }),
    openai: fakeProvider({ id: 'openai', configured: false }),
    replicate: fakeProvider({ id: 'replicate', configured: false }),
  });
}

beforeEach(() => {
  setRateLimiter(new InMemoryRateLimiter());
  auth.authenticate.mockReset().mockResolvedValue(null);
  useProviders();
});

afterEach(() => {
  catalog.override = undefined;
  setProviderOverrides(null);
  setRateLimiter(null);
  vi.unstubAllEnvs();
  resetEnvForTests();
});

const list = async () => invokeRoute<{ data: ModelDTO[] }>(GET, { url: '/api/v1/models' });

describe('GET /api/v1/models', () => {
  it('answers anonymous callers without looking at credentials', async () => {
    const result = await list();
    expect(result.status).toBe(200);
    expect(Array.isArray(result.json.data)).toBe(true);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('also answers signed-in callers, with the same list', async () => {
    catalog.override = models;
    const anonymous = await list();
    auth.authenticate.mockResolvedValue({
      user: {
        id: 'usr_1',
        email: 'a@example.com',
        name: 'A',
        role: 'user',
        locale: 'ar',
        creditBalance: 5,
      },
      via: 'api_key',
      apiKeyId: 'key_1',
    });
    const signedIn = await invokeRoute<{ data: ModelDTO[] }>(GET, {
      url: '/api/v1/models',
      headers: { authorization: 'Bearer avk_test_secret' },
    });
    expect(auth.authenticate).toHaveBeenCalledTimes(1);
    expect(signedIn.json).toEqual(anonymous.json);
  });

  it('works with the real catalog and keeps its invariants', async () => {
    const { json } = await list();
    for (const model of json.data) {
      expect(model).not.toHaveProperty('providerModel');
      expect(typeof model.available).toBe('boolean');
      expect(model.unavailableReason).toBe(model.available ? undefined : 'not_configured');
    }
  });

  describe('with a known catalog', () => {
    beforeEach(() => {
      catalog.override = models;
    });

    it('lists available models first, then images before videos, then by label', async () => {
      const { json } = await list();
      expect(json.data.map((model) => model.id)).toEqual([
        // available: images (Alpha, Charlie, Demo), then videos (Demo, Zed)
        'a-image',
        'c-image',
        'demo-image',
        'demo-video',
        'z-video',
        // unavailable: images, then videos
        'b-image',
        'y-video',
      ]);
    });

    it('marks availability from the provider registry', async () => {
      const byId = new Map((await list()).json.data.map((model) => [model.id, model]));
      expect(byId.get('a-image')).toMatchObject({ available: true });
      expect(byId.get('a-image')).not.toHaveProperty('unavailableReason');
      expect(byId.get('b-image')).toMatchObject({
        available: false,
        unavailableReason: 'not_configured',
      });
      expect(byId.get('y-video')).toMatchObject({
        available: false,
        unavailableReason: 'not_configured',
      });
    });

    it('never exposes the upstream model id', async () => {
      const { text } = await list();
      expect(text).not.toContain('providerModel');
      expect(text).not.toContain('fixture/');
      expect(text).not.toContain('demo/');
    });

    it('keeps the contract fields the UI needs', async () => {
      const dto = (await list()).json.data.find((model) => model.id === 'a-image');
      expect(dto).toMatchObject({
        provider: 'fal',
        kind: 'image',
        tools: ['text-to-image', 'image-to-image'],
        label: 'Alpha image',
        limits: { maxCount: 4, supportsSeed: true },
        pricing: { type: 'image', perImage: 3 },
      });
      expect(dto?.description.ar).toContain('نموذج');
    });

    it('hides Demo models unless ENABLE_MOCK_PROVIDER is on', async () => {
      const on = (await list()).json.data.map((model) => model.id);
      expect(on).toContain('demo-image');
      expect(on).toContain('demo-video');

      vi.stubEnv('ENABLE_MOCK_PROVIDER', 'false');
      resetEnvForTests();
      const off = (await list()).json.data.map((model) => model.id);
      expect(off).not.toContain('demo-image');
      expect(off).not.toContain('demo-video');
      expect(off).toEqual(['a-image', 'c-image', 'z-video', 'b-image', 'y-video']);
    });

    it('lists an unconfigured provider as unavailable rather than hiding it', async () => {
      setProviderOverrides({
        mock: fakeProvider({ id: 'mock', configured: true }),
        fal: fakeProvider({ id: 'fal', configured: false }),
        openai: fakeProvider({ id: 'openai', configured: false }),
        replicate: fakeProvider({ id: 'replicate', configured: false }),
      });
      const { json } = await list();
      expect(json.data.find((model) => model.id === 'a-image')?.available).toBe(false);
      expect(json.data.slice(0, 2).map((model) => model.id)).toEqual(['demo-image', 'demo-video']);
    });
  });

  it('is cacheable only privately, and only briefly', async () => {
    const { headers } = await list();
    const cacheControl = headers.get('cache-control') ?? '';
    expect(cacheControl).toMatch(/\bprivate\b/);
    const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(60);
    expect(cacheControl).not.toMatch(/public|no-store/);
  });

  it('has its own named rate limit instead of the general bucket', async () => {
    const first = await list();
    expect(first.headers.get('x-ratelimit-limit')).toBe('240');
    expect(first.headers.get('x-ratelimit-remaining')).toBe('239');
    expect(first.headers.get('x-request-id')).toBeTruthy();
  });

  it('throttles a client that exceeds the budget, with Retry-After', async () => {
    for (let i = 0; i < 240; i += 1) expect((await list()).status).toBe(200);
    const blocked = await invokeRoute<{ error: { code: string } }>(GET, { url: '/api/v1/models' });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('is read-only', async () => {
    const { POST } = (await import('@/app/api/v1/models/route')) as Record<string, unknown>;
    expect(POST).toBeUndefined();
  });
});
