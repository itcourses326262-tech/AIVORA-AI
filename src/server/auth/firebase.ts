import 'server-only';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppError } from '@/lib/errors';
import type { FirebaseWebConfig } from '@/lib/firebase-config';
import { getEnv, type Env } from '@/server/env';
import { getLogger } from '@/server/logger';

/*
 * Google sign-in through Firebase Authentication, server side. The browser signs in with the
 * Firebase client SDK and posts the resulting ID token to `POST /api/v1/auth/firebase`; this module
 * is the only place that decides whether such a token can be trusted. No Admin SDK and no service
 * account are involved: an ID token is an RS256 JWT whose public keys Google publishes, and the
 * checks below are the ones Firebase documents for verifying it yourself, plus what this app needs
 * (Google as the provider, a verified mailbox).
 */

type FirebaseEnv = Pick<
  Env,
  | 'FIREBASE_API_KEY'
  | 'FIREBASE_AUTH_DOMAIN'
  | 'FIREBASE_PROJECT_ID'
  | 'FIREBASE_APP_ID'
  | 'FIREBASE_AUTH'
>;

export type { FirebaseWebConfig };

/** Google sign-in is offered when it is not switched off and the three web identifiers are set. */
export function isFirebaseAuthEnabled(env: FirebaseEnv = getEnv()): boolean {
  return (
    env.FIREBASE_AUTH !== 'off' &&
    env.FIREBASE_API_KEY !== undefined &&
    env.FIREBASE_AUTH_DOMAIN !== undefined &&
    env.FIREBASE_PROJECT_ID !== undefined
  );
}

/** The configuration handed to the client, or null when Google sign-in is not available. */
export function firebaseWebConfig(env: FirebaseEnv = getEnv()): FirebaseWebConfig | null {
  if (
    !isFirebaseAuthEnabled(env) ||
    env.FIREBASE_API_KEY === undefined ||
    env.FIREBASE_AUTH_DOMAIN === undefined ||
    env.FIREBASE_PROJECT_ID === undefined
  ) {
    return null;
  }
  return {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    ...(env.FIREBASE_APP_ID === undefined ? {} : { appId: env.FIREBASE_APP_ID }),
  };
}

// ---- Token verification ----------------------------------------------------------------------

/** Where Google publishes the public keys that sign Firebase ID tokens. */
export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** A real ID token is about 1 KB; anything near this is not one and is never parsed. */
export const MAX_ID_TOKEN_LENGTH = 4096;
/** A token older than this (since the user actually signed in) is not accepted: the client posts it at once. */
export const MAX_AUTH_AGE_SEC = 10 * 60;
/** Allowed difference between our clock and Google's, for `exp`, `iat` and `auth_time`. */
const CLOCK_TOLERANCE_SEC = 30;
const MAX_SUBJECT_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;

/** The only provider this app signs people in with. */
const REQUIRED_PROVIDER = 'google.com';

export interface FirebaseIdentity {
  /** The Firebase user id: stable for the Google account within the project. */
  subject: string;
  /** Lower case. Google confirmed the person controls this mailbox. */
  email: string;
  /** The Google display name, when the token has one. */
  name: string | null;
}

export interface VerifyOptions {
  /** `FIREBASE_PROJECT_ID`: both the audience and the end of the issuer. */
  projectId: string;
  /** Test clock. */
  now?: Date;
}

/** The token cannot be trusted. Distinct from "we could not check" ({@link KeysUnavailable}). */
class Rejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Google's key set could not be loaded: not the caller's fault, so not a 401. */
class KeysUnavailable extends Error {}

const STATE_KEY = Symbol.for('aivore.firebase-keys');
interface KeyState {
  remote?: JWTVerifyGetKey;
  override: JWTVerifyGetKey | null;
}
type GlobalWithKeys = typeof globalThis & { [STATE_KEY]?: KeyState };

function keyState(): KeyState {
  const scope = globalThis as GlobalWithKeys;
  return (scope[STATE_KEY] ??= { override: null });
}

/**
 * Tests replace the key lookup (so no request to Google is made); `null` restores the real one.
 * The resolver gets the protected header and returns the public key for its `kid`.
 */
export function setFirebaseKeyResolver(resolver: JWTVerifyGetKey | null): void {
  keyState().override = resolver;
}

/**
 * Keys are fetched on the first token, kept for ten minutes and re-fetched when an unknown `kid`
 * shows up, but not more often than every 30 seconds: a stream of tokens with made-up key ids
 * cannot turn this server into a request generator against Google. Kept on `globalThis` so Next.js
 * dev reloads do not drop the cache.
 */
function keyResolver(): JWTVerifyGetKey {
  const state = keyState();
  if (state.override) return state.override;
  state.remote ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL), {
    timeoutDuration: 4000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  return state.remote;
}

/** A key lookup that fails for any reason other than "no such key" means Google was unreachable. */
function guarded(resolve: JWTVerifyGetKey): JWTVerifyGetKey {
  return async (header, token) => {
    try {
      return await resolve(header, token);
    } catch (error) {
      if (
        error instanceof errors.JWKSNoMatchingKey ||
        error instanceof errors.JWKSMultipleMatchingKeys
      ) {
        throw error;
      }
      throw new KeysUnavailable('The signing keys could not be loaded', { cause: error });
    }
  };
}

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

function secondsSince(epochSec: unknown, nowSec: number): number | null {
  return typeof epochSec === 'number' && Number.isFinite(epochSec) ? nowSec - epochSec : null;
}

/** The checks on the claims that jose does not perform itself. */
function checkClaims(payload: JWTPayload, nowSec: number): FirebaseIdentity {
  if (!isText(payload.sub, MAX_SUBJECT_LENGTH)) throw new Rejected('subject');

  // `auth_time` is when the person last signed in with Google, not when the token was issued.
  const sinceSignIn = secondsSince(payload['auth_time'], nowSec);
  if (sinceSignIn === null) throw new Rejected('auth_time_missing');
  if (sinceSignIn < -CLOCK_TOLERANCE_SEC) throw new Rejected('auth_time_future');
  if (sinceSignIn > MAX_AUTH_AGE_SEC + CLOCK_TOLERANCE_SEC) throw new Rejected('auth_time_old');
  const sinceIssued = secondsSince(payload.iat, nowSec);
  if (sinceIssued === null || sinceIssued < -CLOCK_TOLERANCE_SEC) throw new Rejected('iat');

  const firebase = payload['firebase'];
  const provider =
    typeof firebase === 'object' && firebase !== null
      ? (firebase as { sign_in_provider?: unknown }).sign_in_provider
      : undefined;
  // Password, anonymous, custom-token and every other provider are refused: the mailbox of those
  // sign-ins is not vouched for by Google, and linking an account by it would hand it to anybody.
  if (provider !== REQUIRED_PROVIDER) throw new Rejected('provider');

  if (!isText(payload['email'], MAX_EMAIL_LENGTH)) throw new Rejected('email_missing');
  if (payload['email_verified'] !== true) throw new Rejected('email_unverified');

  const name = payload['name'];
  return {
    subject: payload.sub,
    email: payload['email'].trim().toLowerCase(),
    name: typeof name === 'string' && name.trim() !== '' ? name : null,
  };
}

function reasonOf(error: unknown): string {
  if (error instanceof Rejected) return error.reason;
  if (error instanceof errors.JWTExpired) return 'expired';
  if (error instanceof errors.JWTClaimValidationFailed) return `claim_${error.claim}`;
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'signature';
  if (error instanceof errors.JOSEAlgNotAllowed) return 'algorithm';
  if (error instanceof errors.JWKSNoMatchingKey) return 'unknown_key';
  if (error instanceof errors.JWKSMultipleMatchingKeys) return 'ambiguous_key';
  if (error instanceof errors.JOSEError) return 'malformed';
  return 'invalid';
}

/**
 * Verifies a Firebase ID token and returns who it vouches for. Everything that is wrong with the
 * token is one `unauthorized` (401) with a fixed message: the client learns nothing about which
 * check failed (the reason class, never the token, goes to the log). When Google's keys cannot be
 * loaded the answer is `service_busy` (503) instead, because then the caller did nothing wrong.
 *
 * Checked: RS256 only, signature against Google's current keys, issuer
 * `https://securetoken.google.com/<project>`, audience `<project>`, expiry, a non-empty `sub` of at
 * most 128 characters, `iat` and `auth_time` not in the future, a sign-in that happened in the last
 * ten minutes, Google as the provider, and an email that Google reports as verified.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  options: VerifyOptions,
): Promise<FirebaseIdentity> {
  const now = options.now ?? new Date();
  try {
    if (typeof idToken !== 'string' || idToken === '') throw new Rejected('empty');
    if (idToken.length > MAX_ID_TOKEN_LENGTH) throw new Rejected('oversize');
    const { payload } = await jwtVerify(idToken, guarded(keyResolver()), {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${options.projectId}`,
      audience: options.projectId,
      clockTolerance: CLOCK_TOLERANCE_SEC,
      requiredClaims: ['exp', 'iat', 'sub'],
      currentDate: now,
    });
    return checkClaims(payload, Math.floor(now.getTime() / 1000));
  } catch (error) {
    if (error instanceof KeysUnavailable) {
      getLogger().warn('Firebase signing keys unavailable', {
        component: 'auth',
        err: error.cause ?? error,
      });
      throw AppError.of('service_busy', 'Google sign-in is temporarily unavailable', {
        retryAfterSec: 5,
      });
    }
    getLogger().info('Firebase ID token rejected', { component: 'auth', reason: reasonOf(error) });
    throw AppError.of('unauthorized', 'The Google sign-in could not be verified');
  }
}
