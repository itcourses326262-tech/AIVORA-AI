import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  JobFailure,
  TIMEOUT_FAILURE,
  UNEXPECTED_FAILURE,
  describeFailure,
} from '@/server/jobs/failure';
import { PROVIDER_ERROR_CODES, ProviderError } from '@/server/providers/errors';

describe('describeFailure', () => {
  it('shows a JobFailure exactly as written, quietly', () => {
    const described = describeFailure(new JobFailure('invalid_input', 'The input image is gone.'));
    expect(described).toEqual({
      failure: { code: 'invalid_input', message: 'The input image is gone.' },
      severity: 'info',
    });
  });

  it.each(PROVIDER_ERROR_CODES)(
    'maps the provider error %s to a stored code and its user message',
    (code) => {
      const error = new ProviderError(code, 'upstream detail: token=abc123', {
        userMessage: 'Safe words for users.',
      });
      const { failure } = describeFailure(error);
      expect(failure.message).toBe('Safe words for users.');
      expect(JSON.stringify(failure)).not.toContain('abc123');
      expect([
        'invalid_input',
        'content_policy',
        'rate_limited',
        'unavailable',
        'timeout',
        'internal',
      ]).toContain(failure.code);
    },
  );

  it('never tells users which credential is wrong', () => {
    const described = describeFailure(new ProviderError('auth', 'FAL_KEY rejected'));
    expect(described.failure.code).toBe('unavailable');
    expect(described.failure.message).toBe('The generation service is not available right now.');
    expect(described.severity).toBe('error');
  });

  it('rates refusals as routine and outages as warnings', () => {
    expect(describeFailure(new ProviderError('content_policy', 'x')).severity).toBe('info');
    expect(describeFailure(new ProviderError('invalid_input', 'x')).severity).toBe('info');
    for (const code of ['rate_limited', 'unavailable', 'timeout', 'unknown'] as const) {
      expect(describeFailure(new ProviderError(code, 'x')).severity).toBe('warn');
    }
  });

  it('keeps anything unrecognised generic, whatever it says', () => {
    for (const thrown of [
      new TypeError('secret path /srv/app'),
      new Error('boom'),
      AppError.of('internal', 'db exploded'),
      'text',
      42,
      null,
      undefined,
      { message: 'a plain object' },
    ]) {
      expect(describeFailure(thrown)).toEqual({ failure: UNEXPECTED_FAILURE, severity: 'error' });
    }
  });

  it('explains an oversized result without leaking sizes', () => {
    const described = describeFailure(AppError.of('payload_too_large', 'Output is 91234567 bytes'));
    expect(described.failure).toEqual({
      code: 'unavailable',
      message: 'The generation result was too large to keep.',
    });
  });

  it('has fixed generic wording for the two built-in failures', () => {
    expect(UNEXPECTED_FAILURE).toEqual({
      code: 'internal',
      message: 'The generation failed unexpectedly.',
    });
    expect(TIMEOUT_FAILURE).toEqual({
      code: 'timeout',
      message: 'The generation took too long and was stopped.',
    });
  });
});
