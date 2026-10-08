import { describe, expect, it } from 'vitest';
import { addressRoute } from '@/server/auth/address-route';
import type { RateLimitOptions } from '@/server/http/route';
import { invokeRoute } from '../../helpers/http';
import { cleanSecurityState, stubEnv } from './support';

cleanSecurityState();

const PER_ADDRESS: RateLimitOptions = { name: 't-address', limit: 2, windowSec: 60, by: 'ip' };
const SHARED: RateLimitOptions = { name: 't-shared', limit: 4, windowSec: 60, by: 'ip' };
const ORIGIN = 'http://localhost:3000';

const guarded = addressRoute<{ id: string }>(
  { auth: 'none', csrf: true },
  { perAddress: PER_ADDRESS, sharedAddress: SHARED },
  async (ctx) => ({ id: ctx.params.id, ip: ctx.ip }),
);
const unguarded = addressRoute<{ id: string }>(
  { auth: 'none' },
  { perAddress: PER_ADDRESS, sharedAddress: false },
  async () => ({ ok: true }),
);

function post(handler: typeof guarded, headers: Record<string, string> = {}, method = 'POST') {
  return invokeRoute<
    { data: { id: string; ip: string }; error?: { code: string } },
    { id: string }
  >(handler, { url: '/api/v1/t', method, headers, params: { id: 'abc' } });
}

describe('addressRoute', () => {
  it('uses the per-address budget when the proxy tells who the client is', async () => {
    stubEnv({ TRUST_PROXY: 'true' });
    const headers = { origin: ORIGIN, 'x-forwarded-for': '203.0.113.7' };
    const first = await post(guarded, headers);
    expect(first.status).toBe(200);
    expect(first.json.data).toEqual({ id: 'abc', ip: '203.0.113.7' }); // params and ctx.ip pass through
    expect(first.headers.get('x-ratelimit-limit')).toBe('2');
    expect((await post(guarded, headers)).status).toBe(200);
    expect((await post(guarded, headers)).status).toBe(429);
    expect((await post(guarded, { ...headers, 'x-forwarded-for': '203.0.113.8' })).status).toBe(
      200,
    );
  });

  it('uses the shared budget, or none, when the address is unknown, whatever the headers claim', async () => {
    // TRUST_PROXY=false: a forwarded address is never believed.
    const headers = (index: number) => ({
      origin: ORIGIN,
      'x-forwarded-for': `198.51.100.${index}`,
    });
    for (let index = 1; index <= 4; index += 1) {
      const result = await post(guarded, headers(index));
      expect(result.status).toBe(200);
      expect(result.json.data.ip).toBe('unknown');
      expect(result.headers.get('x-ratelimit-limit')).toBe('4');
    }
    expect((await post(guarded, headers(5))).status).toBe(429);

    for (let index = 1; index <= 10; index += 1) {
      const result = await post(unguarded, headers(index));
      expect(result.status).toBe(200);
      expect(result.headers.get('x-ratelimit-limit')).toBeNull();
    }
  });

  it('refuses a cross-site mutating request before any budget is spent, with the usual envelope', async () => {
    stubEnv({ TRUST_PROXY: 'true' });
    for (const headers of [
      {},
      { origin: 'https://evil.example' },
      { referer: 'https://evil.example/x' },
      { origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
    ] as Array<Record<string, string>>) {
      const result = await post(guarded, {
        ...headers,
        'x-forwarded-for': '203.0.113.7',
        'x-request-id': 'req-abcdef123456',
      });
      expect(result.status).toBe(403);
      expect(result.json.error?.code).toBe('forbidden');
      expect(result.headers.get('x-request-id')).toBe('req-abcdef123456');
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(result.headers.get('x-ratelimit-limit')).toBeNull();
    }
    const ok = await post(guarded, { origin: ORIGIN, 'x-forwarded-for': '203.0.113.7' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-ratelimit-remaining')).toBe('1'); // one hit of two: nothing was spent
  });

  it('leaves safe methods and routes without csrf alone', async () => {
    stubEnv({ TRUST_PROXY: 'true' });
    // A GET needs no Origin even on a csrf route; the budget still applies.
    expect((await post(guarded, { 'x-forwarded-for': '203.0.113.7' }, 'GET')).status).toBe(200);
    // Without `csrf: true` an anonymous POST is not origin-checked (nothing ambient to ride on).
    expect((await post(unguarded, { 'x-forwarded-for': '203.0.113.7' })).status).toBe(200);
  });
});
