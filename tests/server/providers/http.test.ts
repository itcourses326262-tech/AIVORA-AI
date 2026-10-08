import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '@/server/logger';
import { ProviderError } from '@/server/providers/errors';
import { httpJson, parseRetryAfter } from '@/server/providers/http';
import { fakeProviderContext } from '../../helpers/fakes';

const URL_ = 'https://api.example.com/v1/jobs?token=abc';

function respond(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function contextWith(fetchImpl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(fetchImpl);
  return { ctx: fakeProviderContext({ fetch: fetchMock }), fetchMock };
}

async function failureOf(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('httpJson requests', () => {
  it('sends a GET with an accept header and returns the parsed JSON', async () => {
    const { ctx, fetchMock } = contextWith(async () => respond({ id: 'job_1' }));
    const result = await httpJson(ctx, { url: URL_ });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: 'job_1' });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(URL_);
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('accept')).toBe('application/json');
    expect(init?.body).toBeUndefined();
  });

  it('serializes a body as JSON and defaults the method to POST', async () => {
    const { ctx, fetchMock } = contextWith(async () => respond({ ok: true }));
    await httpJson(ctx, {
      url: URL_,
      body: { prompt: 'a fox' },
      headers: { authorization: 'Key abc' },
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"prompt":"a fox"}');
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Key abc');
  });

  it('keeps an explicit method and content type', async () => {
    const { ctx, fetchMock } = contextWith(async () => respond({}));
    await httpJson(ctx, {
      url: URL_,
      method: 'PUT',
      body: { a: 1 },
      headers: { 'content-type': 'application/vnd.api+json' },
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/vnd.api+json');
  });

  it('treats an empty success body as undefined data', async () => {
    const { ctx } = contextWith(async () => new Response(null, { status: 204 }));
    const result = await httpJson(ctx, { url: URL_, method: 'DELETE' });
    expect(result.status).toBe(204);
    expect(result.data).toBeUndefined();
  });
});

describe('httpJson response validation', () => {
  const schema = z.object({ id: z.string(), progress: z.number() });

  it('returns data typed and validated by the schema', async () => {
    const { ctx } = contextWith(async () => respond({ id: 'a', progress: 0.5, extra: true }));
    const result = await httpJson(ctx, { url: URL_, schema });
    expect(result.data).toEqual({ id: 'a', progress: 0.5 });
  });

  it('reports a shape mismatch as unknown, naming the paths but not the values', async () => {
    const { ctx } = contextWith(async () => respond({ id: 'secret-value', progress: 'x' }));
    const error = await failureOf(httpJson(ctx, { url: URL_, schema }));
    expect(error.code).toBe('unknown');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('progress');
    expect(error.message).not.toContain('secret-value');
  });

  it('reports a non-JSON success body as unknown', async () => {
    const { ctx } = contextWith(async () => new Response('<html>hello</html>', { status: 200 }));
    const error = await failureOf(httpJson(ctx, { url: URL_ }));
    expect(error.code).toBe('unknown');
    expect(error.message).toContain('not valid JSON');
  });

  it('refuses a success body larger than maxResponseBytes', async () => {
    const { ctx } = contextWith(async () => respond({ blob: 'x'.repeat(5000) }));
    const error = await failureOf(httpJson(ctx, { url: URL_, maxResponseBytes: 1000 }));
    expect(error.code).toBe('unknown');
    expect(error.message).toContain('larger than 1000 bytes');
  });
});

describe('httpJson HTTP errors', () => {
  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [429, 'rate_limited', true],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
    [422, 'invalid_input', false],
  ] as const)('maps HTTP %i to %s', async (status, code, retryable) => {
    const { ctx } = contextWith(async () => respond({ error: { message: 'nope' } }, { status }));
    const error = await failureOf(httpJson(ctx, { url: URL_ }));
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.httpStatus).toBe(status);
  });

  it('includes the upstream explanation in the message but not in the user message', async () => {
    const { ctx } = contextWith(async () =>
      respond({ error: { message: 'model overloaded' } }, { status: 503 }),
    );
    const error = await failureOf(httpJson(ctx, { url: URL_ }));
    expect(error.message).toContain('model overloaded');
    expect(error.userMessage).not.toContain('overloaded');
  });

  it('reads the explanation from the common error payload shapes', async () => {
    for (const payload of [{ error: 'flat' }, { message: 'flat' }, { detail: 'flat' }, '"flat"']) {
      const { ctx } = contextWith(async () => respond(payload, { status: 400 }));
      const error = await failureOf(httpJson(ctx, { url: URL_ }));
      expect(error.message).toContain('flat');
    }
  });

  it('truncates long explanations', async () => {
    const { ctx } = contextWith(async () =>
      respond({ message: 'x'.repeat(2000) }, { status: 400 }),
    );
    const error = await failureOf(httpJson(ctx, { url: URL_ }));
    expect(error.message.length).toBeLessThan(300);
  });

  it('recognizes content-policy payloads on 4xx responses', async () => {
    for (const payload of [
      { error: { code: 'content_policy_violation' } },
      { detail: [{ type: 'content_policy_violation' }] },
      { error: { message: 'Your request was rejected by the safety system.' } },
    ]) {
      const { ctx } = contextWith(async () => respond(payload, { status: 422 }));
      const error = await failureOf(httpJson(ctx, { url: URL_ }));
      expect(error.code).toBe('content_policy');
      expect(error.retryable).toBe(false);
    }
  });

  it('parses Retry-After into retryAfterMs', async () => {
    const { ctx } = contextWith(async () =>
      respond({}, { status: 429, headers: { 'retry-after': '7' } }),
    );
    const error = await failureOf(httpJson(ctx, { url: URL_ }));
    expect(error.retryAfterMs).toBe(7000);
  });

  it('lets classifyError take over, and falls back when it returns undefined', async () => {
    const classifyError = vi.fn((failure: { status: number; body: unknown }) =>
      failure.status === 422
        ? new ProviderError('content_policy', 'custom', { userMessage: 'custom message' })
        : undefined,
    );
    const first = contextWith(async () => respond({ blocked: true }, { status: 422 }));
    const custom = await failureOf(httpJson(first.ctx, { url: URL_, classifyError }));
    expect(custom.userMessage).toBe('custom message');
    expect(classifyError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 422, body: { blocked: true } }),
    );

    const second = contextWith(async () => respond({}, { status: 500 }));
    const generic = await failureOf(httpJson(second.ctx, { url: URL_, classifyError }));
    expect(generic.code).toBe('unavailable');
  });
});

describe('httpJson transport failures and cancellation', () => {
  it('maps a network failure to a retryable unavailable error without leaking the query', async () => {
    const { ctx } = contextWith(async () => {
      throw new TypeError('fetch failed');
    });
    const error = await failureOf(httpJson(ctx, { url: URL_ }));
    expect(error.code).toBe('unavailable');
    expect(error.retryable).toBe(true);
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(error.message).toContain('api.example.com');
    expect(error.message).not.toContain('token=abc');
  });

  it('maps a timeout to a retryable timeout error', async () => {
    const { ctx } = contextWith(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const error = await failureOf(httpJson(ctx, { url: URL_, timeoutMs: 20 }));
    expect(error.code).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('passes a signal that aborts with ctx.signal and rethrows the abort untouched', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Canceled by the user', 'AbortError');
    const { ctx, fetchMock } = contextWith(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const pending = httpJson({ ...ctx, signal: controller.signal }, { url: URL_ });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('does not start the request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { ctx } = contextWith((_url, init) =>
      init?.signal?.aborted ? Promise.reject(init.signal.reason) : Promise.resolve(respond({})),
    );
    await expect(
      httpJson({ ...ctx, signal: controller.signal }, { url: URL_ }),
    ).rejects.not.toBeInstanceOf(ProviderError);
  });
});

describe('httpJson logging', () => {
  it('logs method, host, path and status only, never bodies or the query', async () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'debug', sink: (_level, line) => lines.push(line) });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      respond({ secret: 'response-body-marker' }, { status: 500 }),
    );
    const ctx = fakeProviderContext({ fetch: fetchMock, log });
    await failureOf(httpJson(ctx, { url: URL_, body: { prompt: 'request-body-marker' } }));
    const output = lines.join('\n');
    expect(output).toContain('api.example.com');
    expect(output).toContain('/v1/jobs');
    expect(output).toContain('"status":500');
    expect(output).not.toContain('request-body-marker');
    expect(output).not.toContain('response-body-marker');
    expect(output).not.toContain('token=abc');
    expect(lines.every((line) => JSON.parse(line).level === 'debug')).toBe(true);
  });
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(' 0 ')).toBe(0);
  });

  it('reads an HTTP date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:00:00 GMT', now)).toBe(0);
  });

  it('caps absurd values at one hour', () => {
    expect(parseRetryAfter('999999999')).toBe(3_600_000);
  });

  it('ignores absent or invalid values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});
