import { describe, expect, it } from 'vitest';
import { AUTH_PAGE_PATHS, authPageHeaders, securityHeaders } from '@/server/security/headers';

function headerMap(isProd: boolean): Map<string, string> {
  return new Map(securityHeaders(isProd).map(({ key, value }) => [key, value]));
}

describe('securityHeaders', () => {
  it('forbids framing, sniffing and powerful browser features', () => {
    const headers = headerMap(true);
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('allows images and media from self, data and blob only', () => {
    const csp = headerMap(true).get('Content-Security-Policy') ?? '';
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("media-src 'self' data: blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it('sends HSTS and forbids eval only in production', () => {
    const prod = headerMap(true);
    const dev = headerMap(false);
    expect(prod.get('Strict-Transport-Security')).toMatch(/^max-age=\d+; includeSubDomains$/);
    expect(prod.get('Content-Security-Policy')).not.toContain("'unsafe-eval'");
    expect(dev.has('Strict-Transport-Security')).toBe(false);
    expect(dev.get('Content-Security-Policy')).toContain("'unsafe-eval'");
  });

  it('switches off every powerful browser feature the app does not use', () => {
    const policy = headerMap(true).get('Permissions-Policy') ?? '';
    for (const feature of [
      'camera',
      'microphone',
      'geolocation',
      'payment',
      'usb',
      'serial',
      'hid',
      'display-capture',
      'browsing-topics',
    ]) {
      expect(policy).toContain(`${feature}=()`);
    }
    // Muted autoplaying previews in the gallery must keep working.
    expect(policy).not.toContain('autoplay');
  });

  it('lists only directives browsers recognise (Chrome logs every unknown one in the console)', () => {
    // `bluetooth` was never a standard Permissions-Policy feature: Chrome reports it as
    // "Unrecognized feature" on every page load.
    const policy = headerMap(true).get('Permissions-Policy') ?? '';
    expect(policy).not.toContain('bluetooth');
    const KNOWN = new Set([
      'accelerometer',
      'browsing-topics',
      'camera',
      'display-capture',
      'geolocation',
      'gyroscope',
      'hid',
      'magnetometer',
      'microphone',
      'midi',
      'payment',
      'serial',
      'usb',
    ]);
    const features = policy.split(', ').map((entry) => entry.replace(/=\(\)$/, ''));
    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) expect(KNOWN.has(feature), feature).toBe(true);
  });

  it('allows no frames, no plugins and no foreign base or form targets', () => {
    const csp = headerMap(true).get('Content-Security-Policy') ?? '';
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
  });

  it('does not import server-only code, so next.config.ts can load it', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('../../../src/server/security/headers.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it('emits each header once', () => {
    const keys = securityHeaders(true).map((header) => header.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('authPageHeaders (the sign-in pages that open the Google popup)', () => {
  const authMap = (isProd: boolean) =>
    new Map(authPageHeaders(isProd).map(({ key, value }) => [key, value]));
  const directive = (policy: string | undefined, name: string) =>
    (policy ?? '')
      .split('; ')
      .find((part) => part.startsWith(`${name} `))
      ?.slice(name.length + 1)
      .split(' ');

  it('applies to the login and register pages and to nothing else', () => {
    expect([...AUTH_PAGE_PATHS]).toEqual(['/login', '/register']);
  });

  it('carries exactly the two headers that differ, each once', () => {
    const keys = authPageHeaders(true).map((header) => header.key);
    expect(keys.toSorted()).toEqual(['Content-Security-Policy', 'Cross-Origin-Opener-Policy']);
  });

  it('keeps the opener policy that lets the popup report back, not the one that cuts it off', () => {
    expect(authMap(true).get('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
    expect(headerMap(true).get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('adds the Firebase hosts to the script, connect and frame directives only', () => {
    const csp = authMap(true).get('Content-Security-Policy');
    expect(directive(csp, 'script-src')).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://apis.google.com',
    ]);
    expect(directive(csp, 'connect-src')).toEqual([
      "'self'",
      'https://identitytoolkit.googleapis.com',
    ]);
    expect(directive(csp, 'frame-src')).toEqual(['https://*.firebaseapp.com']);
  });

  it('is a full policy, since it replaces the strict one rather than extending it', () => {
    const strict = (headerMap(true).get('Content-Security-Policy') ?? '').split('; ');
    const relaxed = (authMap(true).get('Content-Security-Policy') ?? '').split('; ');
    expect(relaxed.map((part) => part.split(' ')[0])).toEqual(
      strict.map((part) => part.split(' ')[0]),
    );
  });

  it('never opens up the dangerous directives', () => {
    const csp = authMap(true).get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toMatch(/\*(?![.])|http:|data:[^ ;]*script/); // no bare wildcard, no plain http
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp.match(/https:\/\/[^ ;]+/g)?.toSorted()).toEqual([
      'https://*.firebaseapp.com',
      'https://apis.google.com',
      'https://identitytoolkit.googleapis.com',
    ]);
  });

  it('does not allow the token refresh host: the token is used once, fresh, and never refreshed', () => {
    for (const isProd of [true, false]) {
      expect(authMap(isProd).get('Content-Security-Policy')).not.toContain('securetoken');
    }
  });

  it('allows the development tooling only in development, like the strict policy', () => {
    const dev = authMap(false).get('Content-Security-Policy') ?? '';
    expect(dev).toContain("'unsafe-eval'");
    expect(directive(dev, 'connect-src')).toEqual(
      expect.arrayContaining(["'self'", 'ws:', 'wss:', 'https://identitytoolkit.googleapis.com']),
    );
    expect(authMap(true).get('Content-Security-Policy')).not.toContain('ws:');
  });

  it('does not import anything, so next.config.ts can load it', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('../../../src/server/security/headers.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
