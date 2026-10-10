import type { FirebaseWebConfig } from '@/lib/firebase-config';
import type { Env } from '@/server/env';

/**
 * Whether the log in and sign-up pages show the dashed "Google sign-in is not set up yet" box where
 * the button will be. Only while developing (`next dev`): the public Firebase identifiers are not
 * committed, so on a fresh checkout nothing would otherwise tell the developer that a button is
 * missing. A deployed site (production) and the test runs never show it, and neither does a site
 * where Google sign-in was switched off on purpose.
 */
export function showGoogleSetupPlaceholder(
  env: Pick<Env, 'NODE_ENV' | 'FIREBASE_AUTH'>,
  firebase: FirebaseWebConfig | null,
): boolean {
  return env.NODE_ENV === 'development' && env.FIREBASE_AUTH !== 'off' && firebase === null;
}
