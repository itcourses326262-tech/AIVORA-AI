import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, NotImplementedError } from '@/lib/errors';
import { errorResponse, normalizeError, validationError } from '@/server/http/errors';

function zodError(schema: z.ZodType, input: unknown): z.ZodError {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected validation to fail');
  return result.error;
}

describe('validationError', () => {
  it('lists every problem with a dotted path', () => {
    const schema = z.object({
      name: z.string().min(2),
      params: z.object({ count: z.number().int().max(4) }),
      tags: z.array(z.string()),
    });
    const error = validationError(zodError(schema, { name: 'x', params: { count: 9 }, tags: [1] }));
    expect(error).toMatchObject({
      code: 'validation_failed',
      status: 422,
      message: 'Request validation failed',
    });
    const issues = (error.details as { issues: Array<{ path: string; message: string }> }).issues;
    expect(issues.map((issue) => issue.path).sort()).toEqual(['name', 'params.count', 'tags.0']);
    for (const issue of issues) expect(issue.message.length).toBeGreaterThan(0);
  });

  it('uses an empty path for body-level problems', () => {
    const error = validationError(zodError(z.object({}), 'not an object'));
    expect((error.details as { issues: Array<{ path: string }> }).issues[0]?.path).toBe('');
  });
});

describe('normalizeError', () => {
  it('exposes code, message and details of an AppError', () => {
    expect(
      normalizeError(new AppError('not_found', 404, 'Generation not found', { id: 'gen_1' })),
    ).toEqual({
      status: 404,
      body: {
        error: { code: 'not_found', message: 'Generation not found', details: { id: 'gen_1' } },
      },
    });
  });

  it('omits details when there are none', () => {
    const { body } = normalizeError(AppError.of('forbidden', 'No access'));
    expect(body.error).toEqual({ code: 'forbidden', message: 'No access' });
  });

  it('keeps client-safe messages of non-internal server errors', () => {
    const { status, body } = normalizeError(
      AppError.of('provider_error', 'The model is overloaded'),
    );
    expect(status).toBe(502);
    expect(body.error.message).toBe('The model is overloaded');
  });

  it('hides the message and details of internal errors', () => {
    const { status, body } = normalizeError(
      new AppError('internal', 500, 'SQLITE_BUSY at /srv/app/db.ts', { sql: 'select 1' }),
    );
    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: 'internal', message: 'Internal server error' } });
  });

  it('turns NotImplementedError into a generic 501 internal error', () => {
    const { status, body } = normalizeError(new NotImplementedError('auth.authenticate'));
    expect(status).toBe(501);
    expect(JSON.stringify(body)).not.toContain('auth.authenticate');
    expect(body.error.code).toBe('internal');
  });

  it.each([
    ['an Error', new Error('database password is hunter2')],
    ['a string', 'boom'],
    ['null', null],
    ['an object', { code: 'not_found', status: 404 }],
  ])('maps %s to a generic 500', (_label, thrown) => {
    const { status, body } = normalizeError(thrown);
    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: 'internal', message: 'Internal server error' } });
  });

  it('maps a raw ZodError to a 422 with issues', () => {
    const { status, body } = normalizeError(zodError(z.object({ a: z.string() }), {}));
    expect(status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toMatchObject({ issues: [{ path: 'a' }] });
  });

  it('extracts Retry-After from rate limit and service_busy errors only', () => {
    expect(
      normalizeError(AppError.of('rate_limited', 'Slow down', { retryAfterSec: 12 })).retryAfterSec,
    ).toBe(12);
    expect(normalizeError(AppError.of('rate_limited', 'Slow down')).retryAfterSec).toBeUndefined();
    expect(
      normalizeError(AppError.of('conflict', 'x', { retryAfterSec: 3 })).retryAfterSec,
    ).toBeUndefined();
    expect(
      normalizeError(AppError.of('rate_limited', 'x', { retryAfterSec: 'soon' })).retryAfterSec,
    ).toBeUndefined();
    expect(
      normalizeError(AppError.of('service_busy', 'busy', { retryAfterSec: 600 })).retryAfterSec,
    ).toBe(600);
    expect(normalizeError(AppError.of('service_busy', 'busy')).retryAfterSec).toBeUndefined();
  });
});

describe('errorResponse', () => {
  it('serializes the envelope with the right status', async () => {
    const response = errorResponse(
      AppError.of('insufficient_credits', 'Insufficient credits', { required: 5 }),
    );
    expect(response.status).toBe(402);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({
      error: {
        code: 'insufficient_credits',
        message: 'Insufficient credits',
        details: { required: 5 },
      },
    });
  });

  it('sets Retry-After for rate limits', () => {
    const response = errorResponse(AppError.of('rate_limited', 'Slow down', { retryAfterSec: 30 }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
  });

  it('answers service_busy with 503 and Retry-After', async () => {
    const response = errorResponse(AppError.of('service_busy', 'busy', { retryAfterSec: 900 }));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('900');
    expect(await response.json()).toEqual({
      error: { code: 'service_busy', message: 'busy', details: { retryAfterSec: 900 } },
    });
  });
});
