import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { createTranslator } from '@/lib/i18n';
import {
  FIELD_MESSAGE_KEYS,
  describeSubmitError,
  outcomeIsUnknown,
} from '@/components/studio/submit-errors';
import { FIELD_PATHS } from '@/lib/generations/errors';

const en = createTranslator('en');
const ar = createTranslator('ar');
const failure = (
  status: number,
  code: ConstructorParameters<typeof ApiError>[0],
  details?: unknown,
) => new ApiError(code, status, 'English message for developers', details);

describe('describeSubmitError', () => {
  it('sends a signed-out user to log in', () => {
    const problem = describeSubmitError(en.t, 'en', failure(401, 'unauthorized'));
    expect(problem).toMatchObject({ kind: 'login', fields: [] });
    expect(problem.message).toMatch(/session has expired/);
  });

  it('turns insufficient credits into the "get credits" case', () => {
    const problem = describeSubmitError(
      en.t,
      'en',
      failure(402, 'insufficient_credits', { required: 6, balance: 2 }),
    );
    expect(problem.kind).toBe('credits');
    expect(problem.message).toBe(en.t('errors.insufficient_credits'));
  });

  it('marks the prompt when moderation declines it', () => {
    const problem = describeSubmitError(en.t, 'en', failure(422, 'moderation_blocked'));
    expect(problem).toMatchObject({ kind: 'moderation', fields: ['prompt'] });
    expect(problem.message).toMatch(/content policy/);
  });

  it('lists the fields a validation error names', () => {
    const problem = describeSubmitError(
      en.t,
      'en',
      failure(422, 'validation_failed', {
        issues: [
          { path: 'params.aspectRatio', message: 'x' },
          { path: 'params.seed', message: 'y' },
        ],
      }),
    );
    expect(problem).toMatchObject({ kind: 'validation', fields: ['aspectRatio', 'seed'] });
  });

  it('gives a rate limit its retry hint in the locale, or the general text without one', () => {
    const limited = (details?: unknown) => failure(429, 'rate_limited', details);
    expect(describeSubmitError(en.t, 'en', limited({ retryAfterSec: 12 })).message).toMatch(
      /Try again in 12 sec/,
    );
    expect(describeSubmitError(ar.t, 'ar', limited({ retryAfterSec: 12 })).message).toMatch(/١٢/);
    expect(describeSubmitError(en.t, 'en', limited()).message).toBe(en.t('errors.rate_limited'));
    expect(describeSubmitError(en.t, 'en', limited()).kind).toBe('rate_limited');
  });

  it('recognizes a model that is not set up on this server', () => {
    const problem = describeSubmitError(
      en.t,
      'en',
      failure(409, 'conflict', { reason: 'model_unavailable', modelId: 'fal-flux-schnell' }),
    );
    expect(problem).toMatchObject({ kind: 'model_unavailable', fields: ['modelId'] });
    // Any other conflict is an ordinary one.
    expect(describeSubmitError(en.t, 'en', failure(409, 'conflict')).kind).toBe('other');
  });

  it('calls an overloaded service busy, with the wait the server names', () => {
    for (const error of [
      failure(502, 'provider_error'),
      failure(503, 'service_busy', { retryAfterSec: 90 }),
    ]) {
      expect(describeSubmitError(en.t, 'en', error).kind).toBe('busy');
    }
    expect(
      describeSubmitError(en.t, 'en', failure(503, 'service_busy', { retryAfterSec: 90 })).message,
    ).toMatch(/busy.*90 sec/);
    expect(describeSubmitError(en.t, 'en', failure(502, 'provider_error')).message).toBe(
      en.t('studio.submit.serviceBusy'),
    );
  });

  it('falls back to the text of the error code for everything else, in both languages', () => {
    for (const [status, code] of [
      [429, 'too_many_active'],
      [0, 'network_error'],
      [500, 'internal'],
      [403, 'forbidden'],
    ] as const) {
      const error = failure(status, code);
      expect(describeSubmitError(en.t, 'en', error)).toMatchObject({
        kind: 'other',
        message: en.t(`errors.${code}`),
      });
      expect(describeSubmitError(ar.t, 'ar', error).message).toBe(ar.t(`errors.${code}`));
    }
    expect(describeSubmitError(en.t, 'en', new Error('boom')).message).toBe(
      en.t('errors.internal'),
    );
  });

  it('never shows the English message meant for developers', () => {
    for (const code of [
      'unauthorized',
      'insufficient_credits',
      'rate_limited',
      'internal',
    ] as const) {
      expect(describeSubmitError(en.t, 'en', failure(400, code)).message).not.toMatch(/developers/);
    }
  });
});

describe('FIELD_MESSAGE_KEYS', () => {
  it('has a sentence for every field the server can name', () => {
    for (const field of FIELD_PATHS) {
      expect(en.t(FIELD_MESSAGE_KEYS[field])).not.toMatch(/^studio\./);
      expect(ar.t(FIELD_MESSAGE_KEYS[field])).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('outcomeIsUnknown', () => {
  it('is true when the request may have been accepted: no answer, a server failure, a broken body', () => {
    expect(outcomeIsUnknown(failure(0, 'network_error'))).toBe(true);
    expect(outcomeIsUnknown(failure(500, 'internal'))).toBe(true);
    expect(outcomeIsUnknown(failure(502, 'provider_error'))).toBe(true);
    expect(outcomeIsUnknown(failure(200, 'invalid_response'))).toBe(true);
    expect(outcomeIsUnknown(new Error('unexpected'))).toBe(true);
  });

  it('is false when the server refused the request for good', () => {
    for (const [status, code] of [
      [401, 'unauthorized'],
      [402, 'insufficient_credits'],
      [409, 'conflict'],
      [422, 'validation_failed'],
      [422, 'moderation_blocked'],
      [429, 'rate_limited'],
    ] as const) {
      expect(outcomeIsUnknown(failure(status, code))).toBe(false);
    }
  });
});
