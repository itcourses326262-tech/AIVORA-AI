import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adviceFor,
  runFalCheck,
  upsertEnv,
  validateFalKey,
  type FalCheckResult,
} from '../../scripts/lib/fal-check';
import { ProviderError } from '@/server/providers/errors';
import { TINY_PNG } from '../helpers/fakes';

// Fixtures are assembled at runtime: key-shaped literals are rejected by tests/security.
const KEY = ['fal', 'sk', 'abcd1234efgh5678'].join('_') + ':' + 'secret9876zyxw5432';
const IMAGE_URL = 'https://v3.fal.media/files/test/apple.png';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aivore-fal-check-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fal queue that accepts the request, reports COMPLETED and serves one tiny PNG. */
function fakeFal(overrides: { submit?: () => Response | Promise<Response> } = {}) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    if (url === IMAGE_URL)
      return new Response(TINY_PNG, { headers: { 'content-type': 'image/png' } });
    if (init?.method === 'POST') {
      if (overrides.submit) return overrides.submit();
      return json({
        request_id: 'req_1',
        status_url: 'https://queue.fal.run/fal-ai/flux/requests/req_1/status',
        response_url: 'https://queue.fal.run/fal-ai/flux/requests/req_1',
        cancel_url: 'https://queue.fal.run/fal-ai/flux/requests/req_1/cancel',
      });
    }
    if (url.endsWith('/status')) return json({ status: 'COMPLETED' });
    return json({
      images: [{ url: IMAGE_URL, width: 1, height: 1, content_type: 'image/png' }],
      seed: 7,
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

async function check(fetchFn: typeof fetch, key = KEY) {
  const lines: string[] = [];
  const result = await runFalCheck({
    key,
    fetch: fetchFn,
    say: (line) => lines.push(line),
    outDir: dir,
    sleep: async () => undefined,
  });
  return { result, lines };
}

const failure = (result: FalCheckResult) => {
  if (result.ok) throw new Error('expected a failure');
  return result;
};

describe('validateFalKey', () => {
  it('accepts a normal key and trims it', () => {
    expect(validateFalKey(`  ${KEY}\n`)).toEqual({ ok: true, key: KEY });
  });

  it.each([
    ['', /empty/],
    ['abc def ghi jkl mno pqr stu', /spaces/],
    ['"quoted-key-1234567890abcdef"', /quotes/],
    ['short', /too short/],
    ['x'.repeat(301), /too short or too long/],
  ])('rejects %j', (value, problem) => {
    const result = validateFalKey(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(problem);
  });
});

describe('upsertEnv', () => {
  it('appends missing names and keeps everything else', () => {
    const out = upsertEnv('# my settings\nAPP_URL=http://localhost:3000\n', { FAL_KEY: 'k1' });
    expect(out).toBe('# my settings\nAPP_URL=http://localhost:3000\nFAL_KEY=k1\n');
  });

  it('replaces an existing line once and leaves the other lines alone', () => {
    const out = upsertEnv('FAL_KEY=old\nOTHER=1\nFAL_KEY_NOT=2\n', { FAL_KEY: 'new' });
    expect(out).toBe('FAL_KEY=new\nOTHER=1\nFAL_KEY_NOT=2\n');
  });

  it('creates the file content from nothing and keeps CRLF files CRLF', () => {
    expect(upsertEnv('', { A: '1', B: '2' })).toBe('A=1\nB=2\n');
    expect(upsertEnv('X=1\r\n', { A: '1' })).toBe('X=1\r\nA=1\r\n');
  });
});

describe('runFalCheck', () => {
  it('runs one real-shaped generation, saves the picture and never prints the key', async () => {
    const { fetchFn, calls } = fakeFal();
    const { result, lines } = await check(fetchFn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(result.file)).toBe(true);
    expect(statSync(result.file).size).toBe(TINY_PNG.byteLength);
    expect(result.width).toBe(1);
    expect(readFileSync(result.file).subarray(0, 4)).toEqual(Buffer.from(TINY_PNG.subarray(0, 4)));
    expect(lines.join('\n')).not.toContain(KEY);
    expect(lines).toHaveLength(3);
    // The key goes to fal's queue and never to the picture host.
    expect(
      calls
        .filter((call) => call.auth !== null)
        .every((call) => new URL(call.url).host.endsWith('fal.run')),
    ).toBe(true);
    expect(calls.find((call) => call.url === IMAGE_URL)?.auth).toBeNull();
  });

  it('says what to check when fal rejects the key (401)', async () => {
    const { fetchFn } = fakeFal({ submit: () => json({ detail: 'Invalid key' }, 401) });
    const { result, lines } = await check(fetchFn);
    const failed = failure(result);
    expect(failed.reason).toBe('auth');
    expect(failed.advice).toMatch(/rejected the key/);
    expect(failed.advice).toMatch(/balance/);
    expect(failed.advice + lines.join('')).not.toContain(KEY);
  });

  it('treats an exhausted account (403) like a key problem, with the balance hint', async () => {
    const { fetchFn } = fakeFal({
      submit: () => json({ detail: 'User is locked. Reason: Exhausted balance' }, 403),
    });
    const failed = failure((await check(fetchFn)).result);
    expect(failed.reason).toBe('auth');
    expect(failed.advice).toMatch(/balance/);
  });

  it('reports an unreachable network as a network problem, not a key problem', async () => {
    const down = (async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND queue.fal.run'), {
          code: 'ENOTFOUND',
        }),
      });
    }) as typeof fetch;
    const failed = failure((await check(down)).result);
    expect(failed.reason).toBe('network');
    expect(failed.advice).toMatch(/could not reach fal/i);
    expect(failed.advice).toMatch(/VPN|proxy|firewall/);
  });

  it('refuses to run without a key', async () => {
    const failed = failure((await check(fakeFal().fetchFn, '')).result);
    expect(failed.reason).toBe('no_key');
    expect(failed.advice).toMatch(/setup:fal/);
  });

  it('maps rate limits and outages to their own advice', async () => {
    const limited = failure(
      (await check(fakeFal({ submit: () => json({ detail: 'slow down' }, 429) }).fetchFn)).result,
    );
    expect(limited.reason).toBe('rate_limited');
    expect(adviceFor(new ProviderError('unavailable', 'x', { httpStatus: 503 })).reason).toBe(
      'unavailable',
    );
    expect(adviceFor(new ProviderError('timeout', 'x')).reason).toBe('timeout');
    expect(adviceFor(Object.assign(new Error('x'), { name: 'AbortError' })).reason).toBe('timeout');
  });
});
