import { describe, expect, it } from 'vitest';
import { falProvider } from '@/server/providers/fal';
import { interpretFailure, jobFailure } from '@/server/providers/fal/errors';
import { ProviderError } from '@/server/providers/errors';
import { falHarness, inputFor, jsonResponse, META } from './fixtures';

const SECRET_PROMPT = 'zebra sandwich confidential launch plan';

async function submitFailure(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<ProviderError> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const h = falHarness(
    () =>
      new Response(payload, {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
  );
  const error = await falProvider
    .submit(inputFor('fal-flux-schnell', { prompt: SECRET_PROMPT }), h.ctx)
    .catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

function issue(type: string, extra: Record<string, unknown> = {}) {
  return {
    detail: [{ loc: ['body', 'prompt'], msg: SECRET_PROMPT, type, input: SECRET_PROMPT, ...extra }],
  };
}

describe('HTTP error mapping on submit', () => {
  const matrix: Array<{
    name: string;
    status: number;
    body: unknown;
    headers?: Record<string, string>;
    code: ProviderError['code'];
    retryable: boolean;
  }> = [
    { name: '401', status: 401, body: { detail: 'Invalid key' }, code: 'auth', retryable: false },
    {
      name: '403 locked account',
      status: 403,
      body: { detail: 'User is locked. Reason: Exhausted balance.' },
      code: 'auth',
      retryable: false,
    },
    { name: '402', status: 402, body: { detail: 'pay up' }, code: 'auth', retryable: false },
    {
      name: '422 content_policy_violation',
      status: 422,
      body: issue('content_policy_violation'),
      code: 'content_policy',
      retryable: false,
    },
    {
      name: '422 image_too_small',
      status: 422,
      body: issue('image_too_small', { ctx: { min_height: 512, min_width: 512 } }),
      code: 'invalid_input',
      retryable: false,
    },
    {
      name: '422 validation error of unknown type',
      status: 422,
      body: issue('greater_than'),
      code: 'invalid_input',
      retryable: false,
    },
    {
      name: '422 with a plain detail string',
      status: 422,
      body: { detail: 'bad input' },
      code: 'invalid_input',
      retryable: false,
    },
    {
      name: '400 bad_request',
      status: 400,
      body: { detail: 'bad header', error_type: 'bad_request' },
      code: 'invalid_input',
      retryable: false,
    },
    {
      name: '429',
      status: 429,
      body: { detail: 'Too many requests' },
      headers: { 'retry-after': '7' },
      code: 'rate_limited',
      retryable: true,
    },
    { name: '500', status: 500, body: 'oops', code: 'unavailable', retryable: true },
    {
      name: '502 gateway html',
      status: 502,
      body: '<html>Bad gateway</html>',
      code: 'unavailable',
      retryable: true,
    },
    {
      name: '503 runner scheduling failure',
      status: 503,
      body: { detail: 'no runner', error_type: 'runner_scheduling_failure' },
      code: 'unavailable',
      retryable: true,
    },
    {
      name: '504 request_timeout',
      status: 504,
      body: { detail: 'took too long', error_type: 'request_timeout' },
      code: 'timeout',
      retryable: true,
    },
    {
      name: '504 request_timeout from the header only',
      status: 504,
      body: { detail: 'took too long' },
      headers: { 'x-fal-error-type': 'request_timeout' },
      code: 'timeout',
      retryable: true,
    },
    {
      name: '504 generation_timeout',
      status: 504,
      body: issue('generation_timeout'),
      code: 'timeout',
      retryable: true,
    },
    {
      name: '500 downstream_service_error',
      status: 500,
      body: issue('downstream_service_error'),
      code: 'unavailable',
      retryable: true,
    },
    { name: '408', status: 408, body: '', code: 'timeout', retryable: true },
    {
      name: '499 client_cancelled',
      status: 499,
      body: { detail: 'cancelled', error_type: 'client_cancelled' },
      code: 'unknown',
      retryable: false,
    },
    { name: '404', status: 404, body: { detail: 'Not Found' }, code: 'unknown', retryable: false },
  ];

  it.each(matrix)('$name', async ({ status, body, headers, code, retryable }) => {
    const error = await submitFailure(status, body, headers);
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.httpStatus).toBe(status);
  });

  it('carries Retry-After on a 429', async () => {
    const error = await submitFailure(429, { detail: 'slow' }, { 'retry-after': '7' });
    expect(error.retryAfterMs).toBe(7000);
  });

  it('gives the user a specific, safe message for an unusable image', async () => {
    const error = await submitFailure(422, issue('image_too_small'));
    expect(error.userMessage).toMatch(/too small/i);
    const faces = await submitFailure(422, issue('face_detection_error'));
    expect(faces.userMessage).toMatch(/face/i);
  });

  it('never lets the prompt echoed by fal reach a message', async () => {
    for (const body of [
      issue('content_policy_violation'),
      issue('greater_than'),
      issue('image_load_error'),
    ]) {
      const error = await submitFailure(422, body);
      expect(error.message).not.toContain('zebra');
      expect(error.userMessage).not.toContain('zebra');
      expect(error.message).toContain('prompt');
    }
  });

  it('does not mistake a prompt that mentions "content policy" for a policy rejection', async () => {
    const error = await submitFailure(422, {
      detail: [
        {
          loc: ['body', 'prompt'],
          msg: 'too long',
          type: 'string_too_long',
          input: 'an essay about the content_policy of platforms',
        },
      ],
    });
    expect(error.code).toBe('invalid_input');
  });

  it('keeps the upstream text of a plain detail for logs but not for users', async () => {
    const error = await submitFailure(403, {
      detail: 'User is locked. Reason: Exhausted balance.',
    });
    expect(error.message).toContain('Exhausted balance');
    expect(error.userMessage).not.toContain('Exhausted');
    expect(error.userMessage).not.toContain('balance');
  });
});

describe('interpretFailure', () => {
  const failure = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status,
    headers: new Headers(headers),
    body,
    text: JSON.stringify(body),
  });

  it('leaves non-fal bodies and the generic statuses to the shared mapping', () => {
    expect(interpretFailure(failure(500, undefined))).toBeUndefined();
    expect(interpretFailure(failure(500, 'text'))).toBeUndefined();
    expect(interpretFailure(failure(500, { unrelated: true }))).toBeUndefined();
    for (const status of [401, 402, 403, 429]) {
      expect(interpretFailure(failure(status, issue('content_policy_violation')))).toBeUndefined();
    }
  });

  it('marks a typed payload as reported by fal', () => {
    expect(interpretFailure(failure(422, issue('content_policy_violation')))?.reported).toBe(true);
    expect(interpretFailure(failure(500, { detail: 'x' }))?.reported).toBe(true);
  });

  it('puts a content policy hit ahead of any platform error type', () => {
    const body = { ...issue('content_policy_violation'), error_type: 'bad_request' };
    expect(interpretFailure(failure(422, body))?.error.code).toBe('content_policy');
  });
});

describe('jobFailure (errors inside a queue status)', () => {
  const status = (extra: Record<string, unknown>) => ({ status: 'COMPLETED', ...extra });

  it.each([
    ['content_policy_violation', 'content_policy', false],
    ['request_timeout', 'timeout', true],
    ['runner_disconnected', 'unavailable', true],
    ['bad_request', 'invalid_input', false],
    ['something_new', 'unknown', false],
  ] as const)('maps error_type %s to %s', (errorType, code, retryable) => {
    const error = jobFailure(status({ error_type: errorType, error: 'text' }));
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
  });

  it('recognises a policy hit named only in the error text', () => {
    expect(jobFailure(status({ error: 'content_policy_violation: input flagged' })).code).toBe(
      'content_policy',
    );
  });

  it('is unknown and not retryable with nothing to go on', () => {
    const error = jobFailure({ status: 'FAILED' });
    expect(error.code).toBe('unknown');
    expect(error.retryable).toBe(false);
  });

  it('is exercised end to end through poll', async () => {
    const h = falHarness(() =>
      jsonResponse({ status: 'COMPLETED', error_type: 'request_timeout', error: 'slow' }),
    );
    const result = await falProvider.poll('req_123', inputFor('fal-flux-schnell'), h.ctx, META);
    expect(result).toMatchObject({ status: 'failed', error: { code: 'timeout' } });
  });
});

describe('hostile payload values', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'treats the error type "%s" as an ordinary unknown type',
    async (type) => {
      const typed = await submitFailure(422, issue(type));
      expect(typed.code).toBe('invalid_input');
      expect(typed.retryable).toBe(false);
      const platform = await submitFailure(500, { detail: 'x', error_type: type });
      expect(platform.code).toBe('unavailable');
      expect(jobFailure({ status: 'COMPLETED', error_type: type }).code).toBe('unknown');
    },
  );
});
