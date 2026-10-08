// This module is imported by next.config.ts, which runs outside the Next bundler,
// so it must stay free of `server-only`, path aliases and runtime dependencies.

export interface HeaderEntry {
  key: string;
  value: string;
}

const HSTS_MAX_AGE_SEC = 60 * 60 * 24 * 365;

function contentSecurityPolicy(isProd: boolean): string {
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    // Next.js streams inline bootstrap/RSC scripts; a static header cannot carry a per-request
    // nonce, so 'unsafe-inline' is required. React's dev tooling additionally needs eval.
    ['script-src', isProd ? ["'self'", "'unsafe-inline'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['media-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', isProd ? ["'self'"] : ["'self'", 'ws:', 'wss:']],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

/** Baseline security headers applied to every response by `next.config.ts`. */
export function securityHeaders(isProd: boolean): HeaderEntry[] {
  const headers: HeaderEntry[] = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(isProd) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  ];
  if (isProd) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: `max-age=${HSTS_MAX_AGE_SEC}; includeSubDomains`,
    });
  }
  return headers;
}
