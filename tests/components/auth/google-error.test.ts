import { describe, expect, it } from 'vitest';
import { describeGoogleFailure } from '@/components/auth/google-error';

const translator = { t: (key: string) => key, locale: 'en' as const };
const withCode = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

describe('describeGoogleFailure: a site mistake is told as one', () => {
  it.each([
    'auth/unauthorized-domain',
    'auth/operation-not-allowed',
    'auth/invalid-api-key',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.',
    'auth/requests-from-referer-http://localhost:3000-are-blocked.',
    'auth/requests-to-this-api-identitytoolkit-method-google.cloud.identitytoolkit.v1.x-are-blocked.',
  ])('%s', (code) => {
    expect(describeGoogleFailure(withCode(code), translator)?.message).toBe(
      'auth.google.errors.notConfigured',
    );
  });

  it('keeps the generic sentence for a code it does not know', () => {
    expect(describeGoogleFailure(withCode('auth/internal-error'), translator)?.message).toBe(
      'auth.google.errors.failed',
    );
  });
});
