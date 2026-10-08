import { describe, expect, it } from 'vitest';
import {
  PROVIDER_ERROR_CODES,
  ProviderError,
  isProviderError,
  providerErrorFromStatus,
  type ProviderErrorCode,
} from '@/server/providers/errors';

describe('ProviderError', () => {
  it('has the documented shape', () => {
    const error = new ProviderError('unavailable', 'upstream is down', { httpStatus: 503 });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProviderError');
    expect(error.code).toBe('unavailable');
    expect(error.message).toBe('upstream is down');
    expect(error.httpStatus).toBe(503);
    expect(isProviderError(error)).toBe(true);
    expect(isProviderError(new Error('x'))).toBe(false);
  });

  it.each<[ProviderErrorCode, boolean]>([
    ['invalid_input', false],
    ['content_policy', false],
    ['rate_limited', true],
    ['unavailable', true],
    ['timeout', true],
    ['auth', false],
    ['unknown', false],
  ])('%s is retryable=%s by default', (code, retryable) => {
    expect(new ProviderError(code, 'm').retryable).toBe(retryable);
  });

  it('lets the adapter override retryable and the user message', () => {
    const error = new ProviderError('unknown', 'm', {
      retryable: true,
      userMessage: 'Try again in a minute.',
      retryAfterMs: 5000,
    });
    expect(error.retryable).toBe(true);
    expect(error.userMessage).toBe('Try again in a minute.');
    expect(error.retryAfterMs).toBe(5000);
  });

  it('has a safe, non-empty user message for every code that never mentions credentials', () => {
    for (const code of PROVIDER_ERROR_CODES) {
      const { userMessage } = new ProviderError(code, 'secret detail sk-123');
      expect(userMessage.length).toBeGreaterThan(10);
      expect(userMessage).not.toMatch(/sk-123|key|token/i);
    }
  });

  it('keeps the cause', () => {
    const cause = new TypeError('fetch failed');
    expect(new ProviderError('unavailable', 'm', { cause }).cause).toBe(cause);
  });
});

describe('providerErrorFromStatus', () => {
  it.each<[number, ProviderErrorCode, boolean]>([
    [400, 'invalid_input', false],
    [401, 'auth', false],
    [402, 'auth', false],
    [403, 'auth', false],
    [404, 'unknown', false],
    [408, 'timeout', true],
    [409, 'unknown', false],
    [413, 'invalid_input', false],
    [415, 'invalid_input', false],
    [422, 'invalid_input', false],
    [429, 'rate_limited', true],
    [500, 'unavailable', true],
    [502, 'unavailable', true],
    [503, 'unavailable', true],
    [504, 'unavailable', true],
  ])('maps HTTP %i to %s (retryable=%s)', (status, code, retryable) => {
    const error = providerErrorFromStatus(status);
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.httpStatus).toBe(status);
  });

  it('maps a content-policy payload on a 4xx to content_policy', () => {
    expect(providerErrorFromStatus(400, { contentPolicy: true }).code).toBe('content_policy');
    expect(providerErrorFromStatus(422, { contentPolicy: true }).code).toBe('content_policy');
    expect(providerErrorFromStatus(403, { contentPolicy: true }).code).toBe('content_policy');
  });

  it('never lets a content-policy marker hide rate limits or server errors', () => {
    expect(providerErrorFromStatus(429, { contentPolicy: true }).code).toBe('rate_limited');
    expect(providerErrorFromStatus(500, { contentPolicy: true }).code).toBe('unavailable');
  });

  it('carries the upstream detail in the message and retry hint', () => {
    const error = providerErrorFromStatus(429, { message: 'slow down', retryAfterMs: 2000 });
    expect(error.message).toBe('Provider responded with HTTP 429: slow down');
    expect(error.retryAfterMs).toBe(2000);
    expect(error.userMessage).not.toContain('slow down');
  });
});
