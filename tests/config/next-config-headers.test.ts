import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUTH_PAGE_PATHS as CLIENT_AUTH_PAGE_PATHS } from '@/components/auth/firebase-client';
import { AUTH_PAGE_PATHS, authPageHeaders, securityHeaders } from '@/server/security/headers';

/*
 * What a browser really receives. This loads the real `next.config.ts` in a child process (once as
 * `next build` for production, once as the dev server), takes the header rules through Next.js's own
 * route loader and matcher, and applies them in Next's order. A header that two rules both set
 * must come out as the LATER rule's value: that is the property the auth pages rely on, and the
 * strict policy must survive on every other route.
 */

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(__dirname, 'resolve-next-headers.mjs');

const AUTH_PAGES = ['/login', '/register'];
const OTHER_PATHS = [
  '/',
  '/studio',
  '/gallery',
  '/account',
  '/pricing',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/docs',
  '/explore',
  '/s/abc123',
  '/api/v1/models',
  '/api/v1/auth/login',
  '/api/v1/auth/firebase',
  '/api/v1/media/ast_01',
  '/_next/static/chunks/main.js',
  // Near misses: strict matching means a sub-path or a longer name is not a sign-in page.
  '/login/extra',
  '/login/../studio',
  '/register/extra',
  '/loginx',
  '/registered',
  '/api/login',
  '/studio/login',
];

interface Resolved {
  matched: string[];
  headers: Record<string, string>;
}
interface Evaluation {
  sources: string[];
  result: Record<string, Resolved>;
}

function evaluate(nodeEnv: 'production' | 'development'): Evaluation {
  const output = execFileSync(
    process.execPath,
    [SCRIPT, JSON.stringify([...AUTH_PAGES, ...OTHER_PATHS]), ROOT],
    { env: { ...process.env, NODE_ENV: nodeEnv }, encoding: 'utf8', timeout: 120_000 },
  );
  return JSON.parse(output) as Evaluation;
}

/** `name -> sources` of a Content-Security-Policy. */
function directives(policy: string | undefined): Map<string, string[]> {
  return new Map(
    (policy ?? '').split('; ').map((part) => {
      const [name = '', ...sources] = part.split(' ');
      return [name, sources] as const;
    }),
  );
}

function baseline(isProd: boolean): Record<string, string> {
  return Object.fromEntries(securityHeaders(isProd).map(({ key, value }) => [key, value]));
}

const suites: Array<['production' | 'development', boolean]> = [
  ['production', true],
  ['development', false],
];

describe.each(suites)('next.config headers (%s build)', (nodeEnv, isProd) => {
  let evaluation: Evaluation;
  beforeAll(() => {
    evaluation = evaluate(nodeEnv);
  }, 150_000);

  const effective = (path: string) => evaluation.result[path]?.headers ?? {};

  it('has the baseline rule first and one rule per sign-in page after it', () => {
    expect(evaluation.sources).toEqual(['/:path*', ...AUTH_PAGES]);
  });

  it.each(AUTH_PAGES)('%s: both rules match, the later one wins for the shared keys', (path) => {
    expect(evaluation.result[path]?.matched).toEqual(['/:path*', path]);
    const headers = effective(path);
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups');
    expect(headers['Content-Security-Policy']).toBe(authPageHeaders(isProd)[0]?.value);
    expect(headers['Content-Security-Policy']).not.toBe(
      baseline(isProd)['Content-Security-Policy'],
    );
  });

  it.each(AUTH_PAGES)('%s: only the Firebase popup hosts are added to the policy', (path) => {
    const strict = directives(baseline(isProd)['Content-Security-Policy']);
    const relaxed = directives(effective(path)['Content-Security-Policy']);
    expect([...relaxed.keys()]).toEqual([...strict.keys()]);

    const changed = [...relaxed.keys()].filter(
      (name) => relaxed.get(name)?.join(' ') !== strict.get(name)?.join(' '),
    );
    expect(changed.toSorted()).toEqual(['connect-src', 'frame-src', 'script-src']);

    expect(relaxed.get('script-src')).toEqual([
      ...(strict.get('script-src') ?? []),
      'https://apis.google.com',
    ]);
    expect(relaxed.get('connect-src')).toEqual([
      ...(strict.get('connect-src') ?? []),
      'https://identitytoolkit.googleapis.com',
    ]);
    expect(effective(path)['Content-Security-Policy']).not.toContain('securetoken');
    // 'none' is replaced, never combined with a host.
    expect(relaxed.get('frame-src')).toEqual(['https://*.firebaseapp.com']);
    // Everything that keeps the page from being framed, posting elsewhere or running plugins stays.
    expect(relaxed.get('frame-ancestors')).toEqual(["'none'"]);
    expect(relaxed.get('object-src')).toEqual(["'none'"]);
    expect(relaxed.get('base-uri')).toEqual(["'self'"]);
    expect(relaxed.get('form-action')).toEqual(["'self'"]);
    expect(relaxed.get('default-src')).toEqual(["'self'"]);
    expect(relaxed.get('img-src')).toEqual(strict.get('img-src'));
  });

  it.each(AUTH_PAGES)('%s: every other security header is the strict one', (path) => {
    const strict = baseline(isProd);
    const headers = effective(path);
    for (const [key, value] of Object.entries(strict)) {
      if (key === 'Content-Security-Policy' || key === 'Cross-Origin-Opener-Policy') continue;
      expect(headers[key], key).toBe(value);
    }
    expect(Object.keys(headers).toSorted()).toEqual(Object.keys(strict).toSorted());
    expect(headers['X-Frame-Options']).toBe('DENY');
    if (isProd)
      expect(headers['Strict-Transport-Security']).toMatch(/^max-age=\d+; includeSubDomains$/);
  });

  it.each(OTHER_PATHS)('%s: stays on the strict policy, byte for byte', (path) => {
    expect(evaluation.result[path]?.matched).toEqual(['/:path*']);
    expect(effective(path)).toEqual(baseline(isProd));
    const csp = effective(path)['Content-Security-Policy'] ?? '';
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/google|firebase/i);
    expect(effective(path)['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('spells every overridden key exactly as the baseline does (Next keys the merge by the exact string)', () => {
    const strictKeys = new Set(securityHeaders(isProd).map(({ key }) => key));
    for (const { key } of authPageHeaders(isProd)) expect(strictKeys.has(key), key).toBe(true);
  });
});

describe('the sign-in pages', () => {
  it('are the ones the browser code expects', () => {
    expect([...AUTH_PAGE_PATHS]).toEqual([...CLIENT_AUTH_PAGE_PATHS]);
    expect([...AUTH_PAGE_PATHS]).toEqual(AUTH_PAGES);
  });
});
