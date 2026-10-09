// This module is imported by next.config.ts, which runs outside the Next bundler,
// so it must stay free of `server-only`, path aliases and runtime dependencies.

export interface HeaderEntry {
  key: string;
  value: string;
}

const HSTS_MAX_AGE_SEC = 60 * 60 * 24 * 365;

// Everything the app does not use is switched off for the page and every frame in it.
const PERMISSIONS_POLICY = [
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
]
  .map((feature) => `${feature}=()`)
  .join(', ');

/**
 * The pages from which "Continue with Google" opens its popup. Only these two get the relaxed
 * policy below; every other route keeps the strict one. `components/auth/firebase-client.ts` knows
 * the same list (a test keeps them equal).
 */
export const AUTH_PAGE_PATHS = ['/login', '/register'] as const;

/**
 * What the Firebase popup flow needs on top of the strict policy, read from the `@firebase/auth`
 * code (not guessed):
 *
 * - script: `gapi` is loaded from `apis.google.com/js/api.js` and fetches its iframe module from
 *   the same host;
 * - connect: the SDK talks to `identitytoolkit.googleapis.com` (sign-in, account lookup, the
 *   authorized-domain check). `securetoken.googleapis.com` (token refresh) is deliberately NOT
 *   listed: the token is read once, right after the popup, while it is fresh, and the SDK is
 *   signed out at once, so no refresh is ever asked for (checked in a real browser run);
 * - frame: the hidden helper iframe at `https://<authDomain>/__/auth/iframe`. The popup itself
 *   (`/__/auth/handler`) is a separate window, which CSP does not govern.
 *
 * `frame-src` lists the default Firebase domain `<project>.firebaseapp.com`. A project whose
 * `FIREBASE_AUTH_DOMAIN` is a custom domain needs that origin added here: it is one line, and
 * `next.config.ts` fixes headers at build time, so it cannot follow the environment.
 */
const FIREBASE_SCRIPT_HOSTS = ['https://apis.google.com'];
const FIREBASE_CONNECT_HOSTS = ['https://identitytoolkit.googleapis.com'];
const FIREBASE_FRAME_HOSTS = ['https://*.firebaseapp.com'];

function contentSecurityPolicy(isProd: boolean, authPage: boolean): string {
  const extra = (hosts: string[]) => (authPage ? hosts : []);
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    // Next.js streams inline bootstrap/RSC scripts; a static header cannot carry a per-request
    // nonce, so 'unsafe-inline' is required. React's dev tooling additionally needs eval.
    [
      'script-src',
      [
        ...(isProd
          ? ["'self'", "'unsafe-inline'"]
          : ["'self'", "'unsafe-inline'", "'unsafe-eval'"]),
        ...extra(FIREBASE_SCRIPT_HOSTS),
      ],
    ],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['media-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'", 'data:']],
    [
      'connect-src',
      [...(isProd ? ["'self'"] : ["'self'", 'ws:', 'wss:']), ...extra(FIREBASE_CONNECT_HOSTS)],
    ],
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', authPage ? FIREBASE_FRAME_HOSTS : ["'none'"]],
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
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(isProd, false) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
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

/**
 * The two headers that differ on {@link AUTH_PAGE_PATHS}; every other header of
 * {@link securityHeaders} still applies there. `next.config.ts` lists this rule AFTER the baseline
 * one, and for two matching rules that set the same key the later one wins (Next.js docs, "Header
 * Overriding Behavior"), so each value here is complete, not a patch:
 *
 * - the Content-Security-Policy is the strict one plus the Firebase hosts above;
 * - `Cross-Origin-Opener-Policy: same-origin` would cut the popup off from the page that opened it
 *   (`window.opener` is null and the sign-in can never report back), `same-origin-allow-popups`
 *   keeps the page isolated from windows that open IT while letting it keep the popups it opens.
 */
export function authPageHeaders(isProd: boolean): HeaderEntry[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(isProd, true) },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  ];
}
