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

  it('emits each header once', () => {
    const keys = securityHeaders(true).map((header) => header.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
