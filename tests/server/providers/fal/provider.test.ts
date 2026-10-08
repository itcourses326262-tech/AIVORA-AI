import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/server/logger';
import { falProvider } from '@/server/providers/fal';
import { ProviderError } from '@/server/providers/errors';
import type { PollResult, ProviderContext, ProviderOutput } from '@/server/providers/types';
import {
  FAKE_KEY,
  META,
  QUEUE,
  falHarness,
  inputFor,
  jsonResponse,
  pngImage,
  submitAnswer,
} from './fixtures';

const SCHNELL = 'fal-ai/flux/schnell';
const IMAGE = { url: 'https://v3.fal.media/files/a.jpg', content_type: 'image/jpeg' };

function failedOf(result: PollResult): ProviderError {
  expect(result.status).toBe('failed');
  return (result as Extract<PollResult, { status: 'failed' }>).error;
}

function outputsOf(result: PollResult): ProviderOutput[] {
  expect(result.status).toBe('succeeded');
  return (result as Extract<PollResult, { status: 'succeeded' }>).outputs;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('submit', () => {
  it("posts the body to the queue with the fal auth header and keeps fal's URLs in the meta", async () => {
    const h = falHarness(() => jsonResponse(submitAnswer(SCHNELL, 'req_abc')));
    const result = await falProvider.submit(
      inputFor('fal-flux-schnell', { prompt: 'a lighthouse', params: { count: 2, seed: 5 } }),
      h.ctx,
    );

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const call = h.call(0);
    expect(call.url).toBe(`${QUEUE}/fal-ai/flux/schnell`);
    expect(call.method).toBe('POST');
    expect(call.headers.get('authorization')).toBe(`Key ${FAKE_KEY}`);
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.body).toEqual({
      prompt: 'a lighthouse',
      image_size: { width: 992, height: 992 },
      num_images: 2,
      enable_safety_checker: true,
      seed: 5,
    });

    expect(result).toEqual({
      mode: 'async',
      providerJobId: 'req_abc',
      meta: {
        v: 1,
        requestId: 'req_abc',
        statusUrl: `${QUEUE}/fal-ai/flux/requests/req_abc/status`,
        responseUrl: `${QUEUE}/fal-ai/flux/requests/req_abc`,
        cancelUrl: `${QUEUE}/fal-ai/flux/requests/req_abc/cancel`,
      },
    });
  });

  it('stores the URLs fal returned even when they differ from the canonical layout', async () => {
    const answer = {
      request_id: 'req_x',
      status_url: 'https://queue.fal.run/custom/status/req_x',
      response_url: 'https://queue.fal.run/custom/result/req_x',
      cancel_url: 'https://queue.fal.run/custom/cancel/req_x',
    };
    const h = falHarness(() => jsonResponse(answer));
    const result = await falProvider.submit(inputFor('fal-flux-schnell'), h.ctx);
    expect(result).toMatchObject({
      meta: {
        statusUrl: answer.status_url,
        responseUrl: answer.response_url,
        cancelUrl: answer.cancel_url,
      },
    });
  });

  it('falls back to the canonical queue URLs when the answer has none, using owner and app only', async () => {
    const h = falHarness(() => jsonResponse({ request_id: 'req_y' }));
    const result = await falProvider.submit(inputFor('fal-wan-2-6-t2v'), h.ctx);
    expect(result).toMatchObject({
      providerJobId: 'req_y',
      meta: { statusUrl: `${QUEUE}/wan/v2.6/requests/req_y/status` },
    });
  });

  it("never stores or sends a URL that is not on fal's queue host", async () => {
    const h = falHarness(() =>
      jsonResponse({
        request_id: 'req_z',
        status_url: 'https://evil.example.com/status',
        response_url: 'https://queue.fal.run.evil.example.com/result',
        cancel_url: 'http://queue.fal.run/cancel',
      }),
    );
    const result = await falProvider.submit(inputFor('fal-flux-schnell'), h.ctx);
    const meta = (result as { meta: Record<string, string> }).meta;
    for (const key of ['statusUrl', 'responseUrl', 'cancelUrl']) {
      expect(new URL(meta[key] as string).hostname).toBe('queue.fal.run');
      expect(meta[key]).toMatch(/^https:\/\/queue\.fal\.run\//);
    }
  });

  it('does not put the key or the prompt into the stored meta or into any log line', async () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'debug', sink: (_level, line) => lines.push(line) });
    const h = falHarness(() => jsonResponse(submitAnswer(SCHNELL)));
    const ctx: ProviderContext = { ...h.ctx, log };
    const result = await falProvider.submit(
      inputFor('fal-flux-schnell', { prompt: 'a very secret prompt about foxes' }),
      ctx,
    );
    await falProvider.poll('req_123', inputFor('fal-flux-schnell'), ctx, META).catch(() => {});
    const everything = JSON.stringify(result) + lines.join('\n');
    expect(everything).not.toContain(FAKE_KEY);
    expect(everything).not.toContain('test-key-secret');
    expect(everything).not.toContain('secret prompt');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('sends the input image of an edit model inline, as a data URI', async () => {
    const h = falHarness(() => jsonResponse(submitAnswer('fal-ai/nano-banana-pro/edit')));
    const bytes = await pngImage(300, 200);
    await falProvider.submit(
      { ...inputFor('fal-nano-banana-pro-edit'), inputImage: { bytes, mimeType: 'image/png' } },
      h.ctx,
    );
    const body = h.call(0).body as { image_urls: string[] };
    expect(body.image_urls[0]).toMatch(/^data:image\/png;base64,/);
    expect(h.call(0).url).toBe(`${QUEUE}/fal-ai/nano-banana-pro/edit`);
  });

  it('rejects a submit answer without a request id', async () => {
    const h = falHarness(() => jsonResponse({ status: 'IN_QUEUE' }));
    await expect(falProvider.submit(inputFor('fal-flux-schnell'), h.ctx)).rejects.toMatchObject({
      code: 'unknown',
    });
  });

  it('fails as auth, without any request, when the key is missing', async () => {
    const h = falHarness(() => jsonResponse(submitAnswer(SCHNELL)), { FAL_KEY: undefined });
    await expect(falProvider.submit(inputFor('fal-flux-schnell'), h.ctx)).rejects.toMatchObject({
      code: 'auth',
      retryable: false,
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('passes ctx.signal to fetch and rethrows an abort untouched', async () => {
    const h = falHarness((_url, init) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      h.controller.abort(new DOMException('canceled', 'AbortError'));
      throw new DOMException('canceled', 'AbortError');
    });
    const error = await falProvider
      .submit(inputFor('fal-flux-schnell'), h.ctx)
      .catch((thrown: unknown) => thrown);
    expect(error).not.toBeInstanceOf(ProviderError);
    expect((error as Error).name).toBe('AbortError');
  });

  // fal has no idempotency key: a submit that ends without an HTTP answer may be queued and billed
  // already, so retrying it would create (and pay for) a second request nobody can find or cancel.
  describe('when the outcome of the submit is unknown', () => {
    const submitError = async (h: ReturnType<typeof falHarness>) => {
      const error = await falProvider
        .submit(inputFor('fal-flux-schnell'), h.ctx)
        .catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ProviderError);
      return error as ProviderError;
    };

    it('does not retry a network failure, but still reports it as unavailable', async () => {
      const cause = new TypeError('fetch failed');
      const h = falHarness(() => {
        throw cause;
      });
      const error = await submitError(h);
      expect(error.code).toBe('unavailable');
      expect(error.retryable).toBe(false);
      expect(error.httpStatus).toBeUndefined();
      expect(error.cause).toBe(cause);
      expect(error.userMessage).toMatch(/unavailable/i);
      expect(h.fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry a timeout, but still reports it as a timeout', async () => {
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
      const h = falHarness(() => {
        throw new DOMException('timed out', 'TimeoutError');
      });
      const error = await submitError(h);
      expect(error.code).toBe('timeout');
      expect(error.retryable).toBe(false);
      expect(error.userMessage).toMatch(/too long/i);
    });

    it('does not retry when the answer was lost while its body was being read', async () => {
      const h = falHarness(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('terminated'));
              },
            }),
            { status: 200 },
          ),
      );
      const error = await submitError(h);
      expect(error.code).toBe('unavailable');
      expect(error.retryable).toBe(false);
    });

    it.each([
      [429, 'rate_limited'],
      [500, 'unavailable'],
      [502, 'unavailable'],
      [503, 'unavailable'],
      [504, 'unavailable'],
    ])(
      'keeps retrying when fal answered with HTTP %i, because it did not accept the job',
      async (status, code) => {
        const h = falHarness(() => jsonResponse({ detail: 'try later' }, { status }));
        const error = await submitError(h);
        expect(error.code).toBe(code);
        expect(error.retryable).toBe(true);
        expect(error.httpStatus).toBe(status);
      },
    );

    it('keeps a request_timeout answered by fal (HTTP 504) retryable', async () => {
      const h = falHarness(() =>
        jsonResponse({ detail: 'slow', error_type: 'request_timeout' }, { status: 504 }),
      );
      const error = await submitError(h);
      expect(error.code).toBe('timeout');
      expect(error.retryable).toBe(true);
    });

    it('does not turn a cancellation into a provider error', async () => {
      const h = falHarness(() => {
        h.controller.abort(new DOMException('canceled', 'AbortError'));
        throw new DOMException('canceled', 'AbortError');
      });
      const error = await falProvider
        .submit(inputFor('fal-flux-schnell'), h.ctx)
        .catch((thrown: unknown) => thrown);
      expect(error).not.toBeInstanceOf(ProviderError);
    });
  });
});

describe('poll: status transitions', () => {
  const input = inputFor('fal-flux-schnell');

  it('maps IN_QUEUE to pending and IN_PROGRESS to running with a GET to the stored status URL', async () => {
    const answers = [
      { status: 'IN_QUEUE', queue_position: 3 },
      { status: 'IN_PROGRESS', logs: [] },
    ];
    const h = falHarness(() => jsonResponse(answers.shift()));
    expect(await falProvider.poll('req_123', input, h.ctx, META)).toEqual({ status: 'pending' });
    expect(await falProvider.poll('req_123', input, h.ctx, META)).toEqual({ status: 'running' });
    expect(h.call(0).url).toBe(META.statusUrl);
    expect(h.call(0).method).toBe('GET');
    expect(h.call(0).headers.get('authorization')).toBe(`Key ${FAKE_KEY}`);
  });

  it('on COMPLETED fetches the stored response URL and returns every image', async () => {
    const h = falHarness((url) =>
      url.endsWith('/status')
        ? jsonResponse({ status: 'COMPLETED', logs: [], metrics: { inference_time: 0.4 } })
        : jsonResponse({
            images: [
              { ...IMAGE, width: 992, height: 992 },
              {
                url: 'https://v3.fal.media/files/b.png',
                content_type: 'image/png',
                width: null,
                height: null,
              },
            ],
            seed: 1234,
            has_nsfw_concepts: [false, false],
            timings: { inference: 0.4 },
            prompt: 'x',
          }),
    );
    const outputs = outputsOf(await falProvider.poll('req_123', input, h.ctx, META));
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(h.call(1).url).toBe(META.responseUrl);
    expect(outputs).toEqual([
      {
        kind: 'image',
        url: 'https://v3.fal.media/files/a.jpg',
        mimeType: 'image/jpeg',
        width: 992,
        height: 992,
        seed: 1234,
      },
      { kind: 'image', url: 'https://v3.fal.media/files/b.png', mimeType: 'image/png', seed: 1234 },
    ]);
  });

  it('follows the status and response URLs fal returned instead of rebuilding them', async () => {
    const custom = {
      v: 1,
      requestId: 'req_123',
      statusUrl: `${QUEUE}/custom/abc/status`,
      responseUrl: 'https://eu.queue.fal.run/some/other/layout/result',
      cancelUrl: `${QUEUE}/custom/abc/cancel`,
    };
    const h = falHarness((url) => {
      if (url === custom.statusUrl) return jsonResponse({ status: 'COMPLETED' });
      if (url === custom.responseUrl) return jsonResponse({ images: [IMAGE] });
      return new Response('the canonical URL must not be used', { status: 404 });
    });
    expect(outputsOf(await falProvider.poll('req_123', input, h.ctx, custom))).toHaveLength(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(h.call(0).url).toBe(custom.statusUrl);
    expect(h.call(1).url).toBe(custom.responseUrl);
  });

  it('rebuilds only the URL that is unusable and keeps the other stored ones', async () => {
    const stored = { ...META, statusUrl: 'https://evil.example.net/s' };
    const h = falHarness((url) =>
      url.endsWith('/status')
        ? jsonResponse({ status: 'COMPLETED' })
        : jsonResponse({ images: [IMAGE] }),
    );
    const responseUrl = `${QUEUE}/stored/layout/result`;
    await falProvider.poll('req_123', input, h.ctx, { ...stored, responseUrl });
    expect(h.call(0).url).toBe(`${QUEUE}/fal-ai/flux/requests/req_123/status`);
    expect(h.call(1).url).toBe(responseUrl);
  });

  it('rebuilds the URLs from the endpoint when the meta is missing or damaged', async () => {
    const h = falHarness(() => jsonResponse({ status: 'IN_QUEUE' }));
    await falProvider.poll('req_123', input, h.ctx);
    await falProvider.poll('req_123', input, h.ctx, { v: 1, statusUrl: 5 });
    expect(h.call(0).url).toBe(`${QUEUE}/fal-ai/flux/requests/req_123/status`);
    expect(h.call(1).url).toBe(`${QUEUE}/fal-ai/flux/requests/req_123/status`);
  });

  it('refuses to send the key to a stored URL on another host', async () => {
    const h = falHarness(() => jsonResponse({ status: 'IN_QUEUE' }));
    await falProvider.poll('req_123', input, h.ctx, {
      ...META,
      statusUrl: 'https://attacker.example.net/steal',
    });
    expect(h.call(0).url).toBe(`${QUEUE}/fal-ai/flux/requests/req_123/status`);
    for (let index = 0; index < h.fetchMock.mock.calls.length; index += 1) {
      expect(new URL(h.call(index).url).hostname).toBe('queue.fal.run');
    }
  });

  it('treats an unknown status as still pending and says so without the payload', async () => {
    const warn = vi.fn();
    const h = falHarness(() => jsonResponse({ status: 'WARMING_UP' }));
    const ctx: ProviderContext = { ...h.ctx, log: { ...h.ctx.log, warn } };
    expect(await falProvider.poll('req_123', input, ctx, META)).toEqual({ status: 'pending' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('matches status names case-insensitively', async () => {
    const h = falHarness(() => jsonResponse({ status: 'in_progress' }));
    expect(await falProvider.poll('req_123', input, h.ctx, META)).toEqual({ status: 'running' });
  });
});

describe('poll: failures', () => {
  const input = inputFor('fal-flux-schnell');

  it('returns failed for a FAILED status, classified from the error payload', async () => {
    const h = falHarness(() =>
      jsonResponse({ status: 'FAILED', error: 'boom', error_type: 'runner_server_error' }),
    );
    const error = failedOf(await falProvider.poll('req_123', input, h.ctx, META));
    expect(error.code).toBe('unavailable');
    expect(error.retryable).toBe(true);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns failed for a FAILED status with no payload at all', async () => {
    const h = falHarness(() => jsonResponse({ status: 'FAILED' }));
    const error = failedOf(await falProvider.poll('req_123', input, h.ctx, META));
    expect(error.code).toBe('unknown');
    expect(error.retryable).toBe(false);
  });

  it('returns failed for COMPLETED with an error, mapping a content policy hit', async () => {
    const h = falHarness(() =>
      jsonResponse({
        status: 'COMPLETED',
        error: 'flagged',
        error_type: 'content_policy_violation',
      }),
    );
    const error = failedOf(await falProvider.poll('req_123', input, h.ctx, META));
    expect(error.code).toBe('content_policy');
    expect(error.retryable).toBe(false);
  });

  it('treats null error fields on a completed request as no error', async () => {
    const h = falHarness((url) =>
      url.endsWith('/status')
        ? jsonResponse({ status: 'COMPLETED', error: null, error_type: null })
        : jsonResponse({ images: [IMAGE] }),
    );
    expect(outputsOf(await falProvider.poll('req_123', input, h.ctx, META))).toHaveLength(1);
  });

  it('returns failed when fetching the result of a completed request fails with a model error', async () => {
    const h = falHarness((url) =>
      url.endsWith('/status')
        ? jsonResponse({ status: 'COMPLETED' })
        : jsonResponse(
            {
              detail: [
                { loc: ['body', 'prompt'], msg: 'secret words', type: 'content_policy_violation' },
              ],
            },
            { status: 422 },
          ),
    );
    const error = failedOf(await falProvider.poll('req_123', input, h.ctx, META));
    expect(error.code).toBe('content_policy');
    expect(error.message).not.toContain('secret words');
    expect(error.userMessage).not.toContain('secret words');
  });

  it('returns failed (retryable) for a runner error reported in the result payload', async () => {
    const h = falHarness((url) =>
      url.endsWith('/status')
        ? jsonResponse({ status: 'COMPLETED' })
        : jsonResponse(
            { detail: 'Runner crashed', error_type: 'runner_server_error' },
            { status: 500 },
          ),
    );
    const error = failedOf(await falProvider.poll('req_123', input, h.ctx, META));
    expect(error.code).toBe('unavailable');
    expect(error.retryable).toBe(true);
  });

  it.each([
    ['a gateway page', () => new Response('<html>bad gateway</html>', { status: 502 })],
    [
      'a rate limit',
      () => jsonResponse({ detail: 'slow down' }, { status: 429, headers: { 'retry-after': '7' } }),
    ],
    ['an auth failure', () => jsonResponse({ detail: 'Not authenticated' }, { status: 401 })],
  ])(
    'throws, instead of failing the job, when fetching the result hits %s',
    async (_name, answer) => {
      const h = falHarness((url) =>
        url.endsWith('/status') ? jsonResponse({ status: 'COMPLETED' }) : answer(),
      );
      const error = await falProvider
        .poll('req_123', input, h.ctx, META)
        .catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ProviderError);
    },
  );

  // A result that fal already generated (and billed) must survive a hiccup of the gateway in front
  // of it: the engine treats `failed` as final but retries a thrown retryable error.
  it.each([
    [500, 'Internal Server Error'],
    [502, 'Bad Gateway'],
    [503, 'Service Unavailable'],
    [504, 'Gateway Timeout'],
    [408, 'Request Timeout'],
  ])(
    'throws a retryable error, and the next poll still gets the image, after %i with only a detail string',
    async (status, detail) => {
      let resultCalls = 0;
      const h = falHarness((url) => {
        if (url.endsWith('/status')) return jsonResponse({ status: 'COMPLETED' });
        resultCalls += 1;
        return resultCalls === 1
          ? jsonResponse({ detail }, { status })
          : jsonResponse({ images: [IMAGE] });
      });

      const error = await falProvider
        .poll('req_123', input, h.ctx, META)
        .catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).retryable).toBe(true);
      expect((error as ProviderError).httpStatus).toBe(status);

      expect(outputsOf(await falProvider.poll('req_123', input, h.ctx, META))).toHaveLength(1);
    },
  );

  it.each([
    [404, 'unknown'],
    [400, 'invalid_input'],
    [422, 'invalid_input'],
  ])(
    'returns failed when fetching the result answers %i with a plain detail string',
    async (status, code) => {
      const h = falHarness((url) =>
        url.endsWith('/status')
          ? jsonResponse({ status: 'COMPLETED' })
          : jsonResponse({ detail: 'refused' }, { status }),
      );
      const error = failedOf(await falProvider.poll('req_123', input, h.ctx, META));
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(false);
    },
  );

  it('keeps a network failure while polling retryable', async () => {
    const h = falHarness(() => {
      throw new TypeError('fetch failed');
    });
    await expect(falProvider.poll('req_123', input, h.ctx, META)).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    });
  });

  it('throws a retryable error when the status call itself is unavailable', async () => {
    const h = falHarness(() => new Response('upstream down', { status: 503 }));
    await expect(falProvider.poll('req_123', input, h.ctx, META)).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    });
  });

  it('rethrows an abort untouched while polling', async () => {
    const h = falHarness(() => {
      h.controller.abort(new DOMException('stop', 'AbortError'));
      throw new DOMException('stop', 'AbortError');
    });
    const error = await falProvider
      .poll('req_123', input, h.ctx, META)
      .catch((thrown: unknown) => thrown);
    expect(error).not.toBeInstanceOf(ProviderError);
  });
});

describe('poll: parsing finished results', () => {
  const done = (result: unknown) => (url: string) =>
    url.endsWith('/status') ? jsonResponse({ status: 'COMPLETED' }) : jsonResponse(result);

  it('drops images the safety checker flagged and keeps the rest', async () => {
    const h = falHarness(
      done({
        images: [
          IMAGE,
          { url: 'https://v3.fal.media/files/black.jpg' },
          { url: 'https://v3.fal.media/files/c.jpg' },
        ],
        has_nsfw_concepts: [false, true, false],
      }),
    );
    const outputs = outputsOf(
      await falProvider.poll(
        'req_123',
        inputFor('fal-flux-schnell', { params: { count: 3 } }),
        h.ctx,
        META,
      ),
    );
    expect(outputs.map((output) => output.url)).toEqual([
      'https://v3.fal.media/files/a.jpg',
      'https://v3.fal.media/files/c.jpg',
    ]);
  });

  it('fails with content_policy when every image was flagged', async () => {
    const h = falHarness(done({ images: [IMAGE], has_nsfw_concepts: [true] }));
    const error = failedOf(
      await falProvider.poll('req_123', inputFor('fal-flux-schnell'), h.ctx, META),
    );
    expect(error.code).toBe('content_policy');
    expect(error.retryable).toBe(false);
  });

  it('fails with content_policy when a model answers with text and no image', async () => {
    const h = falHarness(done({ images: [], description: 'I cannot create that picture.' }));
    const error = failedOf(
      await falProvider.poll('req_123', inputFor('fal-nano-banana-pro'), h.ctx, META),
    );
    expect(error.code).toBe('content_policy');
  });

  it('fails with a non-retryable unknown error when there is nothing at all', async () => {
    const h = falHarness(done({}));
    const error = failedOf(
      await falProvider.poll('req_123', inputFor('fal-flux-schnell'), h.ctx, META),
    );
    expect(error.code).toBe('unknown');
    expect(error.retryable).toBe(false);
  });

  it('ignores output URLs that are not https', async () => {
    const h = falHarness(
      done({
        images: [{ url: 'http://v3.fal.media/a.jpg' }, { url: 'data:image/png;base64,AAAA' }],
      }),
    );
    const error = failedOf(
      await falProvider.poll('req_123', inputFor('fal-flux-schnell'), h.ctx, META),
    );
    expect(error.code).toBe('unknown');
  });

  it('rejects a result that is not the expected shape without echoing it', async () => {
    const h = falHarness(done({ images: 'nope' }));
    const error = await falProvider
      .poll('req_123', inputFor('fal-flux-schnell'), h.ctx, META)
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).not.toContain('nope');
  });

  it('returns the single video of a video model with the requested length and the fal mime type', async () => {
    const h = falHarness(
      done({
        video: { url: 'https://v3.fal.media/files/clip.mp4', content_type: 'video/mp4' },
        seed: 99,
      }),
    );
    const outputs = outputsOf(
      await falProvider.poll(
        'req_123',
        inputFor('fal-veo-3-1-fast', { params: { durationSec: 6 } }),
        h.ctx,
        META,
      ),
    );
    expect(outputs).toEqual([
      {
        kind: 'video',
        url: 'https://v3.fal.media/files/clip.mp4',
        mimeType: 'video/mp4',
        durationMs: 6000,
        seed: 99,
      },
    ]);
  });

  it('prefers the duration and size fal reports for the video, and defaults the mime type', async () => {
    const h = falHarness(
      done({
        video: { url: 'https://v3.fal.media/files/clip', duration: 5.04, width: 1280, height: 720 },
      }),
    );
    const outputs = outputsOf(
      await falProvider.poll('req_123', inputFor('fal-wan-2-6-t2v'), h.ctx, META),
    );
    expect(outputs[0]).toMatchObject({
      mimeType: 'video/mp4',
      durationMs: 5040,
      width: 1280,
      height: 720,
    });
  });

  it('fails when a video model returns no video', async () => {
    const h = falHarness(done({ images: [IMAGE] }));
    const error = failedOf(
      await falProvider.poll('req_123', inputFor('fal-wan-2-6-t2v'), h.ctx, META),
    );
    expect(error.code).toBe('unknown');
  });
});

describe('cancel', () => {
  it('PUTs the stored cancel URL with the auth header', async () => {
    const h = falHarness(() => jsonResponse({ status: 'CANCELLATION_REQUESTED' }, { status: 202 }));
    await falProvider.cancel?.('req_123', h.ctx, META);
    const call = h.call(0);
    expect(call.method).toBe('PUT');
    expect(call.url).toBe(META.cancelUrl);
    expect(call.headers.get('authorization')).toBe(`Key ${FAKE_KEY}`);
  });

  it('treats ALREADY_COMPLETED (HTTP 400) as done', async () => {
    const h = falHarness(() => jsonResponse({ status: 'ALREADY_COMPLETED' }, { status: 400 }));
    await expect(falProvider.cancel?.('req_123', h.ctx, META)).resolves.toBeUndefined();
  });

  it('surfaces other failures so the caller can log them', async () => {
    const h = falHarness(() => new Response('', { status: 503 }));
    await expect(falProvider.cancel?.('req_123', h.ctx, META)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('does nothing, and calls nothing, without stored queue URLs', async () => {
    const h = falHarness(() => jsonResponse({}));
    await falProvider.cancel?.('req_123', h.ctx);
    await falProvider.cancel?.('req_123', h.ctx, {});
    await falProvider.cancel?.('req_123', h.ctx, {
      ...META,
      cancelUrl: 'https://evil.example.com/c',
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

describe('no network', () => {
  it('uses only the injected fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const h = falHarness((url) =>
      url.endsWith('/status')
        ? jsonResponse({ status: 'COMPLETED' })
        : jsonResponse({ images: [IMAGE] }),
    );
    await falProvider.submit(
      inputFor('fal-flux-schnell'),
      falHarness(() => jsonResponse(submitAnswer(SCHNELL))).ctx,
    );
    await falProvider.poll('req_123', inputFor('fal-flux-schnell'), h.ctx, META);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
