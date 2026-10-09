import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, isApiError } from '@/lib/api-client';

interface Recorded {
  url: string;
  init: RequestInit;
}

function clientWith(respond: (call: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  });
  return {
    api: createApiClient({ fetch: fetchStub as unknown as typeof fetch }),
    calls,
    fetchStub,
  };
}

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('success responses', () => {
  it('unwraps the data envelope on GET', async () => {
    const { api, calls } = clientWith(() => jsonResponse({ data: { id: 'gen_1' } }));
    await expect(api.get<{ id: string }>('/generations/gen_1')).resolves.toEqual({ id: 'gen_1' });
    expect(calls[0]?.url).toBe('/api/v1/generations/gen_1');
    expect(calls[0]?.init.method).toBe('GET');
    expect(new Headers(calls[0]?.init.headers).get('accept')).toBe('application/json');
  });

  it('normalizes a missing leading slash and a trailing slash on the base URL', async () => {
    const calls: string[] = [];
    const api = createApiClient({
      baseUrl: 'https://example.com/api/v1/',
      fetch: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return jsonResponse({ data: null });
      }) as typeof fetch,
    });
    await api.get('models');
    expect(calls).toEqual(['https://example.com/api/v1/models']);
  });

  it('serializes query parameters, skipping empty values and comma-joining arrays', async () => {
    const { api, calls } = clientWith(() => jsonResponse({ data: [] }));
    await api.get('/generations', {
      query: {
        ids: ['a', 'b'],
        limit: 20,
        favorite: true,
        q: undefined,
        cursor: null,
        kind: 'image',
      },
    });
    expect(calls[0]?.url).toBe('/api/v1/generations?ids=a%2Cb&limit=20&favorite=true&kind=image');
  });

  it('appends query parameters with & when the path already has a query string', async () => {
    const { api, calls } = clientWith(() => jsonResponse({ data: [] }));
    await api.get('/models?kind=image', { query: { available: true } });
    await api.get('/models?kind=image');
    await api.get('/models?kind=image', { query: { q: undefined } });
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/models?kind=image&available=true',
      '/api/v1/models?kind=image',
      '/api/v1/models?kind=image',
    ]);
  });

  it('sends JSON bodies with a JSON content type on POST and PATCH', async () => {
    const { api, calls } = clientWith(() => jsonResponse({ data: { ok: true } }));
    await api.post('/generations', { prompt: 'a cat' }, { headers: { 'Idempotency-Key': 'k1' } });
    await api.patch('/generations/gen_1', { isPublic: true });
    const [post, patch] = calls;
    expect(post?.init.method).toBe('POST');
    expect(post?.init.body).toBe('{"prompt":"a cat"}');
    const postHeaders = new Headers(post?.init.headers);
    expect(postHeaders.get('content-type')).toBe('application/json');
    expect(postHeaders.get('idempotency-key')).toBe('k1');
    expect(patch?.init.method).toBe('PATCH');
    expect(patch?.init.body).toBe('{"isPublic":true}');
  });

  it('sends no body and no content type when POST has no payload', async () => {
    const { api, calls } = clientWith(() => jsonResponse({ data: null }));
    await api.post('/generations/gen_1/cancel');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(new Headers(calls[0]?.init.headers).has('content-type')).toBe(false);
  });

  it('resolves to undefined for 204 responses', async () => {
    const { api } = clientWith(() => new Response(null, { status: 204 }));
    await expect(api.delete('/keys/key_1')).resolves.toBeUndefined();
  });

  it('returns the whole page for list endpoints', async () => {
    const { api } = clientWith(() =>
      jsonResponse({ data: [{ id: 1 }, { id: 2 }], nextCursor: 'abc' }),
    );
    await expect(api.page<{ id: number }>('/generations')).resolves.toEqual({
      data: [{ id: 1 }, { id: 2 }],
      nextCursor: 'abc',
    });
  });
});

describe('cache option', () => {
  const listed = () => jsonResponse({ data: [], nextCursor: null });

  it('sends nothing about caching unless the caller asks, so the browser keeps its defaults', async () => {
    const { api, calls } = clientWith(listed);
    await api.get('/models');
    await api.page('/generations');
    await api.post('/generations', { prompt: 'a cat' });
    await api.patch('/generations/gen_1', { isPublic: true });
    await api.delete('/keys/key_1');
    for (const call of calls) expect(Object.keys(call.init), call.url).not.toContain('cache');
    // The exact shape every other test relies on.
    expect(Object.keys(calls[0]?.init ?? {}).sort()).toEqual(
      ['body', 'headers', 'method', 'signal'].sort(),
    );
  });

  it('hands `cache` to fetch as given', async () => {
    const { api, calls } = clientWith(listed);
    await api.get('/models', { cache: 'no-store' });
    await api.page('/generations', { cache: 'reload' });
    expect(calls.map((call) => call.init.cache)).toEqual(['no-store', 'reload']);
    // Together with the other options, none of which it displaces.
    const controller = new AbortController();
    await api.get('/models', {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'X-Test': '1' },
      query: { kind: 'image' },
    });
    const last = calls[2];
    expect(last?.url).toBe('/api/v1/models?kind=image');
    expect(last?.init.cache).toBe('no-store');
    expect(last?.init.signal).toBe(controller.signal);
    expect(new Headers(last?.init.headers).get('x-test')).toBe('1');
  });
});

describe('upload', () => {
  it('posts multipart form data without setting the content type itself', async () => {
    const { api, calls } = clientWith(() => jsonResponse({ data: { id: 'ast_1' } }));
    const file = new File(['png-bytes'], 'photo.png', { type: 'image/png' });
    await expect(api.upload<{ id: string }>('/uploads', file)).resolves.toEqual({ id: 'ast_1' });

    const call = calls[0];
    expect(call?.init.method).toBe('POST');
    expect(new Headers(call?.init.headers).has('content-type')).toBe(false);
    const form = call?.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const sent = form.get('file') as File;
    expect(sent.name).toBe('photo.png');
    expect(sent.type).toBe('image/png');
    expect(await sent.text()).toBe('png-bytes');
  });

  it('supports a custom field and file name for bare blobs', async () => {
    const { api, calls } = clientWith(() => jsonResponse({ data: {} }));
    await api.upload('/uploads', new Blob(['x']), { fieldName: 'image', filename: 'clip.webp' });
    const form = calls[0]?.init.body as FormData;
    expect((form.get('image') as File).name).toBe('clip.webp');
  });
});

describe('failures', () => {
  it('throws ApiError built from the error envelope', async () => {
    const { api } = clientWith(() =>
      jsonResponse(
        {
          error: {
            code: 'insufficient_credits',
            message: 'Insufficient credits',
            details: { required: 5 },
          },
        },
        {
          status: 402,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_12345678' },
        },
      ),
    );
    const error = await api.post('/generations', {}).catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError',
      code: 'insufficient_credits',
      status: 402,
      message: 'Insufficient credits',
      details: { required: 5 },
      requestId: 'req_12345678',
    });
  });

  it('replaces unknown server codes with one derived from the status', async () => {
    const { api } = clientWith(() =>
      jsonResponse({ error: { code: 'totally_new', message: 'nope' } }, { status: 404 }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'nope',
    });
  });

  it('derives the code from the status when the body is not an envelope', async () => {
    const { api } = clientWith(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'internal', status: 502 });
    const { api: api429 } = clientWith(() => new Response('', { status: 429 }));
    await expect(api429.get('/x')).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
  });

  it('reports a network failure as network_error with the cause attached', async () => {
    const cause = new TypeError('fetch failed');
    const { api } = clientWith(() => {
      throw cause;
    });
    const error = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
    expect(error.cause).toBe(cause);
  });

  it('reports a connection that drops while the body streams as network_error too', async () => {
    const cause = new TypeError('terminated');
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'));
      },
      pull() {
        throw cause;
      },
    });
    const { api } = clientWith(
      () => new Response(broken, { status: 200, headers: { 'x-request-id': 'req_123456789' } }),
    );
    const error = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(isApiError(error)).toBe(true);
    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
    expect(error.requestId).toBe('req_123456789');
    expect(error.cause).toBe(cause);
  });

  it('also converts a body that fails on an error status', async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull() {
        throw new TypeError('terminated');
      },
    });
    const { api } = clientWith(() => new Response(broken, { status: 500 }));
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'network_error', status: 0 });
  });

  it('rethrows an abort that happens while the body streams, untouched', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const stalled = new ReadableStream<Uint8Array>({
      pull() {
        controller.abort();
        throw abortError;
      },
    });
    const { api } = clientWith(() => new Response(stalled, { status: 200 }));
    await expect(api.get('/x', { signal: controller.signal })).rejects.toBe(abortError);
  });

  it('rethrows aborts untouched so callers can tell cancellation from failure', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const { api } = clientWith(() => {
      controller.abort();
      throw abortError;
    });
    await expect(api.get('/x', { signal: controller.signal })).rejects.toBe(abortError);
  });

  it('passes the abort signal to fetch', async () => {
    const controller = new AbortController();
    const { api, calls } = clientWith(() => jsonResponse({ data: 1 }));
    await api.get('/x', { signal: controller.signal });
    expect(calls[0]?.init.signal).toBe(controller.signal);
  });

  it('reports a 2xx body that is not JSON as invalid_response', async () => {
    const { api } = clientWith(() => new Response('<html>', { status: 200 }));
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
  });

  it('reports a 2xx body without the data envelope as invalid_response', async () => {
    const { api } = clientWith(() => jsonResponse({ hello: 'world' }));
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('reports a malformed page as invalid_response', async () => {
    const { api: notArray } = clientWith(() => jsonResponse({ data: {}, nextCursor: null }));
    await expect(notArray.page('/x')).rejects.toMatchObject({ code: 'invalid_response' });
    const { api: noCursor } = clientWith(() => jsonResponse({ data: [] }));
    await expect(noCursor.page('/x')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('quietness', () => {
  it('never writes to the console, on success or failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const ok = clientWith(() => jsonResponse({ data: 1 }));
    const bad = clientWith(() => new Response('x', { status: 500 }));
    await ok.api.get('/x');
    await bad.api.get('/x').catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('looks up the global fetch per call so stubs installed later are honoured', async () => {
    const api = createApiClient();
    const stub = vi.fn(async () => jsonResponse({ data: 'late' }));
    vi.stubGlobal('fetch', stub);
    try {
      await expect(api.get('/x')).resolves.toBe('late');
      expect(stub).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
