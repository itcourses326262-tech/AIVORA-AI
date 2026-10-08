import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  DEFAULT_PAGE_LIMIT,
  capRequestBody,
  hasCredentials,
  isMutatingMethod,
  pageQuerySchema,
  parseOrThrow,
  queryObject,
  readFormBody,
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

  it('cannot be used to replace the prototype of the result via ?__proto__', () => {
    const query = queryObject(new Request(`${URL_BASE}?__proto__=1&__proto__=2&ok=yes`));
    expect(Object.getPrototypeOf(query)).toBeNull();
    expect(Array.isArray(query)).toBe(false);
    expect(Object.keys(query)).toEqual(['ok']);
    expect(query.ok).toBe('yes');
  });

  it('does not mistake inherited members for earlier values', () => {
    const query = queryObject(
      new Request(`${URL_BASE}?constructor=a&toString=b&hasOwnProperty=c&hasOwnProperty=d`),
    );
    expect(query).toEqual({ constructor: 'a', toString: 'b', hasOwnProperty: ['c', 'd'] });
    expect(queryObject(new Request(URL_BASE)).constructor).toBeUndefined();
  });
});

describe('capRequestBody', () => {
  function chunkedPost(chunkBytes: number, chunks: number, onCancel?: () => void): Request {
    let sent = 0;
    return new Request(URL_BASE, {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent++ >= chunks) controller.close();
          else controller.enqueue(new Uint8Array(chunkBytes));
        },
        cancel: onCancel,
      }),
      headers: { 'content-type': 'application/octet-stream' },
      duplex: 'half',
    } as RequestInit);
  }

  it('returns bodiless requests untouched', () => {
    const request = new Request(URL_BASE);
    expect(capRequestBody(request, 10)).toBe(request);
  });

  it('keeps method, url, headers and the body bytes of requests within the cap', async () => {
    const original = post('{"a":1}', { 'content-type': 'application/json', 'x-trace': 't1' });
    const capped = capRequestBody(original, 100);
    expect(capped.method).toBe('POST');
    expect(capped.url).toBe(URL_BASE);
    expect(capped.headers.get('x-trace')).toBe('t1');
    expect(await capped.json()).toEqual({ a: 1 });
  });

  it('rejects an announced length above the cap before touching the body', () => {
    const request = post('x'.repeat(100), {
      'content-type': 'text/plain',
      'content-length': '100',
    });
    expect(() => capRequestBody(request, 50)).toThrowError(
      expect.objectContaining({ code: 'payload_too_large', status: 413 }),
    );
    expect(request.bodyUsed).toBe(false);
  });

  it.each(['text', 'arrayBuffer', 'blob', 'formData'] as const)(
    'fails %s() with payload_too_large when the stream outgrows the cap',
    async (method) => {
      const cancelled = vi.fn();
      const capped = capRequestBody(chunkedPost(512, 1000, cancelled), 2048);
      expect(await codeOf(capped[method]())).toBe('payload_too_large');
      expect(cancelled).toHaveBeenCalled(); // the source is released, not drained
    },
  );

  it('fails the raw stream too', async () => {
    const reader = capRequestBody(chunkedPost(512, 1000), 2048).body!.getReader();
    let failure: unknown;
    try {
      for (;;) if ((await reader.read()).done) break;
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'payload_too_large' });
  });

  it('allows a body of exactly the cap', async () => {
    const capped = capRequestBody(chunkedPost(512, 4), 2048);
    expect((await capped.arrayBuffer()).byteLength).toBe(2048);
  });

  it('propagates the abort signal of the original request', () => {
    const controller = new AbortController();
    const original = new Request(URL_BASE, {
      method: 'POST',
      body: 'x',
      signal: controller.signal,
    });
    const capped = capRequestBody(original, 10);
    expect(capped.signal.aborted).toBe(false);
    controller.abort();
    expect(capped.signal.aborted).toBe(true);
  });
});

describe('readFormBody', () => {
  it('parses multipart bodies, including Arabic text and files', async () => {
    const form = new FormData();
    form.append('prompt', 'قطة');
    form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'a.bin');
    const parsed = await readFormBody(new Request(URL_BASE, { method: 'POST', body: form }));
    expect(parsed.get('prompt')).toBe('قطة');
    expect((parsed.get('file') as File).size).toBe(3);
  });

  it('answers 415 for other content types, including url-encoded forms', async () => {
    expect(await codeOf(readFormBody(post('{}')))).toBe('unsupported_media_type');
    expect(
      await codeOf(
        readFormBody(post('a=b', { 'content-type': 'application/x-www-form-urlencoded' })),
      ),
    ).toBe('unsupported_media_type');
    expect(await codeOf(readFormBody(new Request(URL_BASE, { method: 'POST' })))).toBe(
      'unsupported_media_type',
    );
  });

  it('answers 400 for a body that is not valid multipart', async () => {
    const broken = post('garbage', { 'content-type': 'multipart/form-data; boundary=nope' });
    expect(await codeOf(readFormBody(broken))).toBe('bad_request');
    const noBoundary = post('garbage', { 'content-type': 'multipart/form-data' });
    expect(await codeOf(readFormBody(noBoundary))).toBe('bad_request');
  });

  it('lets payload_too_large from a capped body through instead of masking it as 400', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(10_000)]), 'big.bin');
    const capped = capRequestBody(new Request(URL_BASE, { method: 'POST', body: form }), 1000);
    expect(await codeOf(readFormBody(capped))).toBe('payload_too_large');
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
