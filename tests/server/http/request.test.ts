import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DEFAULT_PAGE_LIMIT,
  hasCredentials,
  isMutatingMethod,
  pageQuerySchema,
  parseOrThrow,
  queryObject,
  readJsonBody,
  requestIdOf,
} from '@/server/http/request';

const URL_BASE = 'http://localhost:3000/api/v1/test';

function post(
  body: BodyInit | null,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) {
  return new Request(URL_BASE, { method: 'POST', body, headers });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('readJsonBody', () => {
  it('parses a JSON object', async () => {
    expect(await readJsonBody(post('{"prompt":"a cat","n":[1,2]}'))).toEqual({
      prompt: 'a cat',
      n: [1, 2],
    });
  });

  it('accepts a charset parameter and +json media types', async () => {
    expect(
      await readJsonBody(post('{"a":1}', { 'content-type': 'application/json; charset=utf-8' })),
    ).toEqual({ a: 1 });
    expect(
      await readJsonBody(post('{"a":1}', { 'content-type': 'application/vnd.api+json' })),
    ).toEqual({ a: 1 });
  });

  it('returns undefined when there is no body or it is blank', async () => {
    expect(await readJsonBody(new Request(URL_BASE, { method: 'POST' }))).toBeUndefined();
    expect(await readJsonBody(post(''))).toBeUndefined();
    expect(await readJsonBody(post('  \n '))).toBeUndefined();
  });

  it('decodes UTF-8 (Arabic prompts)', async () => {
    expect(await readJsonBody(post(JSON.stringify({ prompt: 'قطة تلعب في الحديقة' })))).toEqual({
      prompt: 'قطة تلعب في الحديقة',
    });
  });

  it.each([
    ['text/plain', 'unsupported_media_type'],
    ['application/x-www-form-urlencoded', 'unsupported_media_type'],
    ['multipart/form-data; boundary=x', 'unsupported_media_type'],
    ['application/jsonp', 'unsupported_media_type'],
    ['', 'unsupported_media_type'],
  ])('rejects content type "%s"', async (contentType, code) => {
    const headers: Record<string, string> = contentType ? { 'content-type': contentType } : {};
    expect(
      await codeOf(readJsonBody(new Request(URL_BASE, { method: 'POST', body: '{}', headers }))),
    ).toBe(code);
  });

  it('rejects malformed JSON with bad_request', async () => {
    expect(await codeOf(readJsonBody(post('{"a":')))).toBe('bad_request');
    expect(await codeOf(readJsonBody(post('undefined')))).toBe('bad_request');
  });

  it('rejects bytes that are not UTF-8', async () => {
    expect(await codeOf(readJsonBody(post(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))))).toBe(
      'bad_request',
    );
  });

  it('rejects bodies over the limit using Content-Length without reading them', async () => {
    const request = post('x'.repeat(100), {
      'content-type': 'application/json',
      'content-length': '100',
    });
    expect(await codeOf(readJsonBody(request, 50))).toBe('payload_too_large');
    expect(request.bodyUsed).toBe(false);
  });

  it('enforces the limit while streaming when Content-Length is absent or a lie', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024).fill(0x20));
        if (pulls > 1000) controller.close();
      },
    });
    const request = new Request(URL_BASE, {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'application/json', 'content-length': '2' },
      duplex: 'half',
    } as RequestInit);
    expect(await codeOf(readJsonBody(request, 4096))).toBe('payload_too_large');
    expect(pulls).toBeLessThan(20); // stopped early instead of draining the stream
  });

  it('allows a body of exactly the limit', async () => {
    const body = JSON.stringify({ a: 'x'.repeat(20) });
    expect(await readJsonBody(post(body), new TextEncoder().encode(body).byteLength)).toEqual({
      a: 'x'.repeat(20),
    });
  });

  it('defaults to a 1 MiB limit', async () => {
    const big = JSON.stringify({ a: 'x'.repeat(1024 * 1024) });
    expect(await codeOf(readJsonBody(post(big)))).toBe('payload_too_large');
  });
});

describe('queryObject', () => {
  it('collects single values and repeats into arrays', () => {
    const request = new Request(`${URL_BASE}?kind=image&ids=a&ids=b&ids=c&empty=`);
    expect(queryObject(request)).toEqual({ kind: 'image', ids: ['a', 'b', 'c'], empty: '' });
  });

  it('is empty without a query string', () => {
    expect(queryObject(new Request(URL_BASE))).toEqual({});
  });
});

describe('parseOrThrow', () => {
  it('returns parsed data (including coercion and defaults)', () => {
    expect(parseOrThrow(z.object({ n: z.coerce.number().default(3) }), { n: '7' })).toEqual({
      n: 7,
    });
  });

  it('throws a 422 validation_failed with issues', () => {
    try {
      parseOrThrow(z.object({ n: z.number() }), { n: 'x' });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'validation_failed', status: 422 });
    }
  });
});

describe('pageQuerySchema', () => {
  it('defaults the limit and leaves the cursor unset', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_LIMIT });
  });

  it('coerces query-string numbers', () => {
    expect(pageQuerySchema.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
  });

  it.each([{ limit: '0' }, { limit: '101' }, { limit: '1.5' }, { limit: 'many' }, { cursor: '' }])(
    'rejects %j',
    (input) => {
      expect(pageQuerySchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('hasCredentials', () => {
  const withHeaders = (headers: Record<string, string>) => new Request(URL_BASE, { headers });

  it('sees an Authorization header or the session cookie', () => {
    expect(hasCredentials(withHeaders({ authorization: 'Bearer avk_x' }))).toBe(true);
    expect(hasCredentials(withHeaders({ cookie: 'theme=dark; aivore_session=abc' }))).toBe(true);
    expect(hasCredentials(withHeaders({ cookie: 'aivore_session=abc' }))).toBe(true);
  });

  it('ignores unrelated cookies and look-alikes', () => {
    expect(hasCredentials(new Request(URL_BASE))).toBe(false);
    expect(hasCredentials(withHeaders({ cookie: 'theme=dark' }))).toBe(false);
    expect(hasCredentials(withHeaders({ cookie: 'not_aivore_session=abc' }))).toBe(false);
    expect(hasCredentials(withHeaders({ cookie: 'aivore_session_extra=abc' }))).toBe(false);
  });
});

describe('requestIdOf', () => {
  it('reuses a well-formed inbound id', () => {
    const request = new Request(URL_BASE, { headers: { 'x-request-id': 'req-1234.abcd_EF' } });
    expect(requestIdOf(request)).toBe('req-1234.abcd_EF');
  });

  it.each([
    'short',
    'has spaces in it',
    'new\nline-injection',
    'x'.repeat(65),
    '<script>alert(1)</script>',
  ])('replaces the suspicious id %j with a fresh UUID', (value) => {
    const request = new Request(URL_BASE, {
      headers: { 'x-request-id': value.replace(/\n/g, ' ') },
    });
    expect(requestIdOf(request)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('generates unique ids when none is sent', () => {
    const request = new Request(URL_BASE);
    expect(requestIdOf(request)).not.toBe(requestIdOf(request));
  });
});

describe('isMutatingMethod', () => {
  it('flags only state-changing methods, case-insensitively', () => {
    for (const method of ['POST', 'put', 'Patch', 'DELETE'])
      expect(isMutatingMethod(method)).toBe(true);
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(isMutatingMethod(method)).toBe(false);
  });
});
