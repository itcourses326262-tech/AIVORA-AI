import { describe, expect, it } from 'vitest';
import {
  AppError,
  CLIENT_ERROR_CODES,
  ERROR_CODES,
  ERROR_STATUS,
  NotImplementedError,
  codeForStatus,
  defaultStatus,
  errorCodeOf,
  isAnyErrorCode,
  isAppError,
  isErrorCode,
} from '@/lib/errors';

describe('error codes', () => {
  it('maps every code to the status documented in ARCHITECTURE.md', () => {
    expect(ERROR_STATUS).toEqual({
      bad_request: 400,
      validation_failed: 422,
      unauthorized: 401,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      payload_too_large: 413,
      unsupported_media_type: 415,
      moderation_blocked: 422,
      insufficient_credits: 402,
      rate_limited: 429,
      too_many_active: 429,
      signup_disabled: 403,
      email_not_verified: 403,
      email_not_allowed: 422,
      signup_limit: 429,
      password_not_set: 409,
      provider_error: 502,
      service_busy: 503,
      internal: 500,
    });
    expect(ERROR_CODES).toHaveLength(20);
  });

  it('recognizes codes without being fooled by inherited object keys', () => {
    expect(isErrorCode('not_found')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode('network_error')).toBe(false);
    expect(isAnyErrorCode('network_error')).toBe(true);
    expect(isAnyErrorCode('invalid_response')).toBe(true);
    expect(isAnyErrorCode(404)).toBe(false);
    expect(CLIENT_ERROR_CODES).toEqual(['network_error', 'invalid_response']);
  });

  it('exposes the default status per code', () => {
    expect(defaultStatus('insufficient_credits')).toBe(402);
  });
});

describe('AppError', () => {
  it('carries code, status, message and details', () => {
    const error = new AppError('not_found', 404, 'Generation not found', { id: 'gen_1' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('not_found');
    expect(error.status).toBe(404);
    expect(error.message).toBe('Generation not found');
    expect(error.details).toEqual({ id: 'gen_1' });
  });

  it('AppError.of uses the default status for the code', () => {
    const error = AppError.of('rate_limited', 'Slow down', { retryAfterSec: 3 });
    expect(error.status).toBe(429);
    expect(error.details).toEqual({ retryAfterSec: 3 });
  });

  it('keeps the cause', () => {
    const cause = new Error('db down');
    expect(new AppError('internal', 500, 'x', undefined, { cause }).cause).toBe(cause);
  });

  it('isAppError narrows only real AppErrors', () => {
    expect(isAppError(AppError.of('internal', 'x'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError({ code: 'internal', status: 500 })).toBe(false);
  });
});

describe('NotImplementedError', () => {
  it('is an AppError that surfaces as an internal 501', () => {
    const error = new NotImplementedError('auth.authenticate');
    expect(isAppError(error)).toBe(true);
    expect(error.name).toBe('NotImplementedError');
    expect(error.code).toBe('internal');
    expect(error.status).toBe(501);
    expect(error.message).toBe('Not implemented: auth.authenticate');
  });
});

describe('errorCodeOf', () => {
  it('reads the code of AppError-like values', () => {
    expect(errorCodeOf(AppError.of('forbidden', 'x'))).toBe('forbidden');
    expect(errorCodeOf({ code: 'network_error' })).toBe('network_error');
  });

  it('falls back to internal for anything else', () => {
    expect(errorCodeOf(new Error('boom'))).toBe('internal');
    expect(errorCodeOf({ code: 'ECONNRESET' })).toBe('internal');
    expect(errorCodeOf(null)).toBe('internal');
    expect(errorCodeOf('oops')).toBe('internal');
  });
});

describe('codeForStatus', () => {
  it.each([
    [401, 'unauthorized'],
    [402, 'insufficient_credits'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [413, 'payload_too_large'],
    [415, 'unsupported_media_type'],
    [422, 'validation_failed'],
    [429, 'rate_limited'],
    [400, 'bad_request'],
    [418, 'bad_request'],
    [500, 'internal'],
    [502, 'internal'],
    [503, 'internal'],
  ])('%i -> %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});
