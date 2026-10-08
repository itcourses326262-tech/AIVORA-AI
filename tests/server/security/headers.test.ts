import { describe, expect, it } from 'vitest';
import { securityHeaders } from '@/server/security/headers';

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
      'bluetooth',
      'hid',
      'display-capture',
      'browsing-topics',
    ]) {
      expect(policy).toContain(`${feature}=()`);
    }
    // Muted autoplaying previews in the gallery must keep working.
    expect(policy).not.toContain('autoplay');
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
