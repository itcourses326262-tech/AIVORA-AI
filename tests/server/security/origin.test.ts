import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { resetEnvForTests } from '@/server/env';
import { assertSameOrigin } from '@/server/security/origin';

beforeEach(() => {
  vi.stubEnv('TRUST_PROXY', 'false'); // whatever the developer's shell says
  resetEnvForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

const APP = 'http://localhost:3000'; // APP_URL in tests

function req(method: string, headers: Record<string, string> = {}, url = `${APP}/api/v1/things`) {
  return new Request(url, { method, headers });
}

function verdict(request: Request): 'allowed' | 'blocked' {
  try {
    assertSameOrigin(request);
    return 'allowed';
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('forbidden');
    expect((error as AppError).status).toBe(403);
    return 'blocked';
  }
}

describe('safe methods are exempt', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('%s passes whatever the origin says', (method) => {
    expect(verdict(req(method, { origin: 'https://evil.example' }))).toBe('allowed');
    expect(verdict(req(method))).toBe('allowed');
  });
});

describe('cookie requests (no API key) on mutating methods', () => {
  const cookie = { cookie: 'aivore_session=abc' };

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s: the same Origin passes', (method) => {
    expect(verdict(req(method, { ...cookie, origin: APP }))).toBe('allowed');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s: a foreign Origin is blocked', (method) => {
    expect(verdict(req(method, { ...cookie, origin: 'https://evil.example' }))).toBe('blocked');
  });

  it('blocks look-alike origins: other scheme, port, subdomain, suffix, userinfo', () => {
    for (const origin of [
      'https://localhost:3000',
      'http://localhost:3001',
      'http://localhost',
      'http://app.localhost:3000',
      'http://localhost:3000.evil.example',
      'http://evil.example/localhost:3000',
      'http://localhost:3000@evil.example',
      'http://evilocalhost:3000',
    ]) {
      expect(verdict(req('POST', { ...cookie, origin })), origin).toBe('blocked');
    }
  });

  it('blocks Origin: null, garbage and non-http schemes', () => {
    for (const origin of [
      'null',
      '',
      'garbage',
      'file://',
      'chrome-extension://abc',
      'javascript:alert(1)',
    ]) {
      expect(verdict(req('POST', { ...cookie, origin })), origin).toBe('blocked');
    }
  });

  it('accepts the Referer when there is no Origin, and only a matching one', () => {
    expect(verdict(req('POST', { ...cookie, referer: `${APP}/studio?x=1` }))).toBe('allowed');
    expect(verdict(req('POST', { ...cookie, referer: 'https://evil.example/studio' }))).toBe(
      'blocked',
    );
    expect(verdict(req('POST', { ...cookie, referer: 'nonsense' }))).toBe('blocked');
  });

  it('lets Origin win over Referer: a foreign Origin with a friendly Referer is blocked', () => {
    expect(
      verdict(req('POST', { ...cookie, origin: 'https://evil.example', referer: `${APP}/` })),
    ).toBe('blocked');
  });

  it('blocks a request with neither Origin nor Referer', () => {
    expect(verdict(req('POST', cookie))).toBe('blocked');
    expect(verdict(req('POST'))).toBe('blocked');
  });

  it('blocks Sec-Fetch-Site: cross-site even when Origin looks right', () => {
    expect(verdict(req('POST', { ...cookie, origin: APP, 'sec-fetch-site': 'cross-site' }))).toBe(
      'blocked',
    );
    expect(verdict(req('POST', { ...cookie, origin: APP, 'sec-fetch-site': 'same-origin' }))).toBe(
      'allowed',
    );
  });
});

describe('API key requests', () => {
  const bearer = { authorization: `Bearer avk_abcd1234_${'s'.repeat(43)}` };

  it('may omit Origin and Referer: a script has no ambient cookie to ride on', () => {
    expect(verdict(req('POST', bearer))).toBe('allowed');
    expect(verdict(req('DELETE', bearer))).toBe('allowed');
  });

  it('only a Bearer avk_ header earns that: other credentials do not', () => {
    expect(verdict(req('POST', { authorization: 'Bearer something' }))).toBe('blocked');
    expect(verdict(req('POST', { authorization: 'Basic dXNlcjpwYXNz' }))).toBe('blocked');
    expect(verdict(req('POST', { authorization: 'Bearer avk_' }))).toBe('blocked');
    // Whether the key is real is authenticate()'s business; this only recognises the kind of client.
    expect(verdict(req('POST', { authorization: 'Bearer avk_x' }))).toBe('allowed');
  });

  it('still blocks a foreign Origin: a browser is involved, so the check applies', () => {
    expect(verdict(req('POST', { ...bearer, origin: 'https://evil.example' }))).toBe('blocked');
  });
});

describe('own origins', () => {
  it('accepts the origin the browser used even when APP_URL is wrong (Host header)', () => {
    const request = new Request('http://127.0.0.1:3000/api/v1/x', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' },
    });
    expect(verdict(request)).toBe('allowed');
  });

  it('does not accept an Origin that merely differs from the Host', () => {
    const request = new Request('http://127.0.0.1:3000/api/v1/x', {
      method: 'POST',
      headers: { origin: 'https://evil.example', host: '127.0.0.1:3000' },
    });
    expect(verdict(request)).toBe('blocked');
  });

  it('honours X-Forwarded-Host and -Proto only when TRUST_PROXY=true', () => {
    const forwarded = {
      origin: 'https://aivore.example',
      host: 'app:3000',
      'x-forwarded-host': 'aivore.example',
      'x-forwarded-proto': 'https',
    };
    expect(verdict(new Request(`${APP}/x`, { method: 'POST', headers: forwarded }))).toBe(
      'blocked',
    );

    vi.stubEnv('TRUST_PROXY', 'true');
    resetEnvForTests();
    expect(verdict(new Request(`${APP}/x`, { method: 'POST', headers: forwarded }))).toBe(
      'allowed',
    );
    expect(
      verdict(
        new Request(`${APP}/x`, {
          method: 'POST',
          headers: { ...forwarded, origin: 'https://evil.example' },
        }),
      ),
    ).toBe('blocked');
  });

  it('trusts the configured APP_URL', () => {
    vi.stubEnv('APP_URL', 'https://aivore.example');
    resetEnvForTests();
    expect(verdict(req('POST', { origin: 'https://aivore.example' }))).toBe('allowed');
    expect(verdict(req('POST', { origin: APP }))).toBe('blocked');
  });
});
