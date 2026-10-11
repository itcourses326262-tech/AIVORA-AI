import { describe, expect, it } from 'vitest';
import { adviceForKeyError, runFirebaseCheck } from '../../scripts/lib/firebase-check';
import { checkFirebaseConfig } from '../../scripts/lib/firebase-config';

const KEY = ['AI', 'za', 'Sy', 'x'.repeat(33)].join('');
const input = { apiKey: KEY, projectId: 'demo-project', origin: 'http://localhost:3000' };

type Answer = { status: number; body: unknown } | Error;

/** A fetch that answers by path: `projects` for the key check, `createAuthUri` for the method. */
function fakeFetch(answers: { projects: Answer; createAuthUri?: Answer }) {
  const seen: Array<{ url: string; referer: string | null }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const text = String(url);
    seen.push({ url: text, referer: new Headers(init?.headers).get('Referer') });
    const answer = text.includes('createAuthUri') ? answers.createAuthUri : answers.projects;
    if (answer === undefined || answer instanceof Error) throw answer ?? new Error('unexpected');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  return { impl, seen };
}

const googleError = (status: number, reason: string, message: string) => ({
  status,
  body: { error: { code: status, message, status: 'X', details: [{ reason }] } },
});

describe('runFirebaseCheck', () => {
  it('reports a healthy key, domain and method', async () => {
    const { impl, seen } = fakeFetch({
      projects: {
        status: 200,
        body: { projectId: 'demo-project', authorizedDomains: ['localhost'] },
      },
      createAuthUri: { status: 200, body: { authUri: 'https://accounts.google.com/x' } },
    });
    const lines = await runFirebaseCheck(input, { fetchImpl: impl });
    expect(lines.every((line) => line.ok)).toBe(true);
    expect(lines.map((line) => line.title).join('\n')).toContain('Google accepts it');
    // The page address is sent so a key limited to websites is judged as the browser would be.
    expect(seen[0]?.referer).toBe('http://localhost:3000/');
  });

  it('names a key Google does not know and stops there', async () => {
    const { impl, seen } = fakeFetch({
      projects: googleError(
        400,
        'API_KEY_INVALID',
        'API key not valid. Please pass a valid API key.',
      ),
    });
    const lines = await runFirebaseCheck(input, { fetchImpl: impl });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.ok).toBe(false);
    expect(lines[0]?.advice).toContain('Copy apiKey again');
    expect(seen).toHaveLength(1);
  });

  it('flags a key that has the wrong shape even before Google answers', async () => {
    const { impl } = fakeFetch({
      projects: googleError(400, 'API_KEY_INVALID', 'API key not valid.'),
    });
    const lines = await runFirebaseCheck(
      { ...input, apiKey: 'AIzaSyDX••••••••' },
      { fetchImpl: impl },
    );
    expect(lines[0]?.title).toContain('not the shape of a Firebase key');
    // The last four characters are shown on purpose: a key pasted as dots is visible at once.
    expect(lines[0]?.title).toContain('ends "••••"');
  });

  it('never prints the whole key', async () => {
    const { impl } = fakeFetch({
      projects: googleError(400, 'API_KEY_INVALID', 'API key not valid.'),
    });
    const lines = await runFirebaseCheck(input, { fetchImpl: impl });
    expect(JSON.stringify(lines)).not.toContain(KEY);
  });

  it('says when the domain is not authorized', async () => {
    const { impl } = fakeFetch({
      projects: { status: 200, body: { authorizedDomains: ['shop.example.test'] } },
      createAuthUri: { status: 200, body: {} },
    });
    const lines = await runFirebaseCheck(input, { fetchImpl: impl });
    const domain = lines.find((line) => line.title.includes('authorized domains'));
    expect(domain?.ok).toBe(false);
    expect(domain?.advice).toContain('Authorized domains');
  });

  it('says when the key belongs to another project', async () => {
    const { impl } = fakeFetch({
      projects: { status: 200, body: { projectId: 'other-project', authorizedDomains: [] } },
      createAuthUri: { status: 200, body: {} },
    });
    const lines = await runFirebaseCheck(input, { fetchImpl: impl });
    expect(lines.some((line) => line.title.includes('other-project'))).toBe(true);
  });

  it('says when the Google method is switched off', async () => {
    const { impl } = fakeFetch({
      projects: { status: 200, body: { authorizedDomains: ['localhost'] } },
      createAuthUri: googleError(400, 'OPERATION_NOT_ALLOWED', 'OPERATION_NOT_ALLOWED'),
    });
    const lines = await runFirebaseCheck(input, { fetchImpl: impl });
    const method = lines.at(-1);
    expect(method?.ok).toBe(false);
    expect(method?.advice).toContain('Sign-in method');
  });

  it('turns a network failure into a line instead of throwing', async () => {
    const { impl } = fakeFetch({ projects: new Error('getaddrinfo ENOTFOUND') });
    const lines = await runFirebaseCheck(input, { fetchImpl: impl });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.title).toBe('Could not reach Google.');
  });
});

describe('adviceForKeyError', () => {
  it.each([
    [{ status: 403, reason: 'API_KEY_HTTP_REFERRER_BLOCKED', message: '' }, 'Website restrictions'],
    [{ status: 403, reason: 'API_KEY_SERVICE_BLOCKED', message: '' }, 'Identity Toolkit API'],
    [{ status: 400, reason: 'CONFIGURATION_NOT_FOUND', message: '' }, 'Get started'],
    [
      { status: 418, reason: 'ODD', message: 'something new' },
      'Google answered ODD: something new',
    ],
  ])('%j', (error, text) => {
    expect(adviceForKeyError(error)).toContain(text);
  });
});

describe('the wizard rejects a key with characters a real one never has', () => {
  it('refuses the masking dots and a trailing dot', () => {
    for (const apiKey of ['AIzaSyDX••••••••••••••••••••••••••••', `${KEY}.`, `${KEY} x`]) {
      const check = checkFirebaseConfig({
        apiKey,
        authDomain: 'demo-project.firebaseapp.com',
        projectId: 'demo-project',
        appId: '1:123:web:abc',
      });
      expect(check.problems.join(' ')).toContain('apiKey');
    }
  });
});
