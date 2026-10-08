import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/v1/openapi.json/route';
import { buildOpenApiDocument } from '@/lib/openapi/spec';
import { resetEnvForTests } from '@/server/env';
import { setRateLimiter } from '@/server/security/rate-limit';
import { invokeRoute } from '../../../helpers/http';

const ENDPOINT = '/api/v1/openapi.json';
const ORIGIN = 'http://localhost:3000';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
  vi.stubEnv('TRUST_PROXY', 'false');
  vi.stubEnv('APP_URL', ORIGIN);
  resetEnvForTests();
  setRateLimiter(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  setRateLimiter(null);
});

describe('GET /api/v1/openapi.json', () => {
  it('serves the bare OpenAPI document, not an envelope', async () => {
    const result = await invokeRoute<Record<string, unknown>>(GET, { url: ENDPOINT });
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(result.json.openapi).toBe('3.1.0');
    expect(result.json).not.toHaveProperty('data');
    expect(result.json).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument(ORIGIN))));
  });

  it('points the server URL at the origin of APP_URL', async () => {
    vi.stubEnv('APP_URL', 'https://aivore.example/some/path');
    resetEnvForTests();
    const result = await invokeRoute<{ servers: Array<{ url: string }> }>(GET, { url: ENDPOINT });
    expect(result.json.servers[0]?.url).toBe('https://aivore.example/api/v1');
  });

  it('needs no credentials and ignores bad ones', async () => {
    const bearer = await invokeRoute(GET, {
      url: ENDPOINT,
      headers: { authorization: 'Bearer avk_deadbeef_not-a-key', cookie: 'aivore_session=junk' },
    });
    expect(bearer.status).toBe(200);
  });

  it('may be cached by browsers and CDNs, and read from any web page', async () => {
    const result = await invokeRoute(GET, { url: ENDPOINT });
    expect(result.headers.get('cache-control')).toBe(
      'public, max-age=300, stale-while-revalidate=600',
    );
    expect(result.headers.get('access-control-allow-origin')).toBe('*');
    expect(result.headers.get('etag')).toMatch(/^"[\w-]{27}"$/);
    expect(result.headers.get('x-request-id')).toBeTruthy();
  });

  describe('revalidation', () => {
    it('answers 304 without a body when the ETag matches', async () => {
      const first = await invokeRoute(GET, { url: ENDPOINT });
      const etag = first.headers.get('etag') ?? '';
      const again = await invokeRoute(GET, { url: ENDPOINT, headers: { 'if-none-match': etag } });
      expect(again.status).toBe(304);
      expect(again.text).toBe('');
      expect(again.headers.get('etag')).toBe(etag);
      expect(again.headers.get('cache-control')).toContain('max-age=300');
    });

    it('understands weak validators and lists of tags', async () => {
      const etag = (await invokeRoute(GET, { url: ENDPOINT })).headers.get('etag') ?? '';
      const weak = await invokeRoute(GET, {
        url: ENDPOINT,
        headers: { 'if-none-match': `W/${etag}` },
      });
      expect(weak.status).toBe(304);
      const list = await invokeRoute(GET, {
        url: ENDPOINT,
        headers: { 'if-none-match': `"other", ${etag}` },
      });
      expect(list.status).toBe(304);
    });

    it('sends the document again for a stale tag', async () => {
      const stale = await invokeRoute(GET, {
        url: ENDPOINT,
        headers: { 'if-none-match': '"stale"' },
      });
      expect(stale.status).toBe(200);
      expect(stale.text.length).toBeGreaterThan(10_000);
    });

    it('has a different ETag for a different origin', async () => {
      const here = (await invokeRoute(GET, { url: ENDPOINT })).headers.get('etag');
      vi.stubEnv('APP_URL', 'https://aivore.example');
      resetEnvForTests();
      const there = (await invokeRoute(GET, { url: ENDPOINT })).headers.get('etag');
      expect(there).not.toBe(here);
    });
  });

  it('is rate limited per client address', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    resetEnvForTests();
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    for (let index = 0; index < 60; index += 1) {
      expect((await invokeRoute(GET, { url: ENDPOINT, headers })).status).toBe(200);
    }
    const blocked = await invokeRoute<{ error: { code: string } }>(GET, { url: ENDPOINT, headers });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('rate_limited');
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    const other = await invokeRoute(GET, {
      url: ENDPOINT,
      headers: { 'x-forwarded-for': '203.0.113.8' },
    });
    expect(other.status).toBe(200);
  });
});
