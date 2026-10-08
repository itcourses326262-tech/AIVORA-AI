import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  FIELD_PATHS,
  failureReason,
  fieldOfPath,
  isModelUnavailable,
  retryAfterSeconds,
  validationFields,
} from '@/lib/generations/errors';
import { createTranslator } from '@/lib/i18n';

const en = createTranslator('en');
const ar = createTranslator('ar');

describe('failureReason', () => {
  it('says why in the active language, one sentence per engine failure code', () => {
    for (const code of [
      'content_policy',
      'invalid_input',
      'rate_limited',
      'unavailable',
      'timeout',
      'internal',
    ]) {
      const english = failureReason(en.t, { error: { code, message: 'English for logs' } });
      const arabic = failureReason(ar.t, { error: { code, message: 'English for logs' } });
      expect(english).not.toBe('English for logs');
      expect(english).not.toMatch(/^studio\./);
      expect(arabic).toMatch(/[؀-ۿ]/);
    }
    expect(failureReason(en.t, { error: { code: 'content_policy', message: '' } })).toMatch(
      /content policy/i,
    );
  });

  it('falls back to a generic sentence for a code it does not know, or none', () => {
    const generic = en.t('studio.generations.failure.unknown');
    expect(failureReason(en.t, { error: { code: 'something_new', message: '' } })).toBe(generic);
    expect(failureReason(en.t, {})).toBe(generic);
  });
});

describe('validation errors', () => {
  const invalid = (issues: unknown) =>
    new ApiError('validation_failed', 422, 'Request validation failed', { issues });

  it('maps a request path to the form field', () => {
    expect(fieldOfPath('params.count')).toBe('count');
    expect(fieldOfPath('params.aspectRatio')).toBe('aspectRatio');
    expect(fieldOfPath('prompt')).toBe('prompt');
    expect(fieldOfPath('inputAssetId')).toBe('inputAssetId');
    expect(fieldOfPath('params.unknown')).toBeNull();
    expect(fieldOfPath('')).toBeNull();
    expect(FIELD_PATHS).toContain('negativePrompt');
  });

  it('lists each refused field once, in the order of the issues', () => {
    const error = invalid([
      { path: 'params.durationSec', message: 'x' },
      { path: 'prompt', message: 'y' },
      { path: 'params.durationSec', message: 'again' },
      { path: 'nonsense', message: 'z' },
    ]);
    expect(validationFields(error)).toEqual(['durationSec', 'prompt']);
  });

  it('is empty for other errors and for malformed details', () => {
    expect(validationFields(new ApiError('internal', 500, 'x'))).toEqual([]);
    expect(validationFields(invalid('not a list'))).toEqual([]);
    expect(validationFields(invalid([null, { path: 3 }]))).toEqual([]);
    expect(validationFields(new Error('plain'))).toEqual([]);
  });
});

describe('retry hints and the model_unavailable conflict', () => {
  it('reads how long the server asks to wait, rounded up', () => {
    const limited = (details: unknown) => new ApiError('rate_limited', 429, 'slow down', details);
    expect(retryAfterSeconds(limited({ retryAfterSec: 12 }))).toBe(12);
    expect(retryAfterSeconds(limited({ retryAfterSec: 1.2 }))).toBe(2);
    expect(retryAfterSeconds(limited({ retryAfterSec: 0 }))).toBeUndefined();
    expect(retryAfterSeconds(limited({ retryAfterSec: 'soon' }))).toBeUndefined();
    expect(retryAfterSeconds(limited(undefined))).toBeUndefined();
    expect(retryAfterSeconds(new Error('x'))).toBeUndefined();
  });

  it('recognizes a model that is not configured on this server', () => {
    const conflict = (reason: string) =>
      new ApiError('conflict', 409, 'x', { reason, modelId: 'fal-flux-schnell' });
    expect(isModelUnavailable(conflict('model_unavailable'))).toBe(true);
    expect(isModelUnavailable(conflict('idempotency_key_reused'))).toBe(false);
    expect(isModelUnavailable(new ApiError('not_found', 404, 'x'))).toBe(false);
  });
});
