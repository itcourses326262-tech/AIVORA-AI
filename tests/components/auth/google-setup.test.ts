import { describe, expect, it } from 'vitest';
import { showGoogleSetupPlaceholder } from '@/components/auth/google-setup';
import type { FirebaseWebConfig } from '@/lib/firebase-config';

const CONFIG: FirebaseWebConfig = {
  apiKey: 'k'.repeat(30),
  authDomain: 'test-project.firebaseapp.com',
  projectId: 'test-project',
};

describe('showGoogleSetupPlaceholder', () => {
  it('shows only in development, with Google sign-in not set up and not switched off', () => {
    expect(
      showGoogleSetupPlaceholder({ NODE_ENV: 'development', FIREBASE_AUTH: 'auto' }, null),
    ).toBe(true);
  });

  it.each(['production', 'test'] as const)('never shows in %s', (NODE_ENV) => {
    expect(showGoogleSetupPlaceholder({ NODE_ENV, FIREBASE_AUTH: 'auto' }, null)).toBe(false);
    expect(showGoogleSetupPlaceholder({ NODE_ENV, FIREBASE_AUTH: 'off' }, null)).toBe(false);
  });

  it('does not show when FIREBASE_AUTH=off: somebody turned it off on purpose', () => {
    expect(
      showGoogleSetupPlaceholder({ NODE_ENV: 'development', FIREBASE_AUTH: 'off' }, null),
    ).toBe(false);
  });

  it('does not show once the real button does', () => {
    expect(
      showGoogleSetupPlaceholder({ NODE_ENV: 'development', FIREBASE_AUTH: 'auto' }, CONFIG),
    ).toBe(false);
  });
});
