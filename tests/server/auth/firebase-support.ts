import {
  SignJWT,
  errors,
  exportSPKI,
  generateKeyPair,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { afterEach, beforeAll, beforeEach } from 'vitest';
import { setFirebaseKeyResolver } from '@/server/auth/firebase';

export const PROJECT_ID = 'test-project';
export const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
export const KID = 'test-key-1';

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

export interface Minter {
  /** Signs a token that passes every check unless `claims` says otherwise (`undefined` drops a claim). */
  mint(claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
  /** A token signed by a key Google never published. */
  mintWithStrangerKey(claims?: Record<string, unknown>): Promise<string>;
  /**
   * A token with a VALID signature for `alg`, made with a key the resolver does serve (under the
   * same key id): only the algorithm differs from a real Firebase token, so a verifier that does
   * not pin RS256 would accept it.
   */
  mintWithAlgorithm(
    alg: 'RS384' | 'RS512' | 'PS256',
    claims?: Record<string, unknown>,
  ): Promise<string>;
  /**
   * An HS256 token whose HMAC secret is the public key itself: the classic algorithm-confusion
   * forgery, valid for a verifier that lets the token choose HMAC and feeds it the RSA public key.
   */
  mintHmacWithPublicKey(claims?: Record<string, unknown>): Promise<string>;
}

/** The claims of a good Google sign-in, `now` seconds being the clock of the test. */
export function goodClaims(overrides: Record<string, unknown> = {}, now = Date.now() / 1000) {
  const second = Math.floor(now);
  const claims: Record<string, unknown> = {
    iss: ISSUER,
    aud: PROJECT_ID,
    sub: 'firebase-uid-1',
    iat: second - 5,
    auth_time: second - 5,
    exp: second + 3600,
    email: 'layla@example.com',
    email_verified: true,
    name: 'Layla Hassan',
    firebase: { sign_in_provider: 'google.com', identities: {} },
    ...overrides,
  };
  for (const key of Object.keys(claims)) if (claims[key] === undefined) delete claims[key];
  return claims;
}

/**
 * Key material is generated per test file and never written anywhere: the repository must not
 * contain key-shaped literals (see `tests/security/no-secret-literals.test.ts`). The resolver given
 * to the code under test serves only the one public key, like Google's key set would.
 */
export function firebaseKeyFixture(): Minter {
  let pair: KeyPair;
  let stranger: KeyPair;
  const others = new Map<string, KeyPair>();

  beforeAll(async () => {
    pair = await generateKeyPair('RS256', { extractable: true });
    stranger = await generateKeyPair('RS256', { extractable: true });
    for (const alg of ['RS384', 'RS512', 'PS256']) {
      others.set(alg, await generateKeyPair(alg, { extractable: true }));
    }
  });

  const resolver: JWTVerifyGetKey = async (header) => {
    if (header.kid !== KID) throw new errors.JWKSNoMatchingKey();
    // A resolver that serves whatever key fits the algorithm the token asks for.
    return (header.alg ? others.get(header.alg) : undefined)?.publicKey ?? pair.publicKey;
  };
  beforeEach(() => setFirebaseKeyResolver(resolver));
  afterEach(() => setFirebaseKeyResolver(null));

  async function sign(key: KeyPair['privateKey'], claims: JWTPayload, header: object) {
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: KID, ...header }).sign(key);
  }

  return {
    mint: (claims, header = {}) => sign(pair.privateKey, goodClaims(claims), header),
    mintWithStrangerKey: (claims) => sign(stranger.privateKey, goodClaims(claims), {}),
    mintWithAlgorithm: async (alg, claims) => {
      const key = others.get(alg);
      if (!key) throw new Error(`no key for ${alg}`);
      return new SignJWT(goodClaims(claims))
        .setProtectedHeader({ alg, kid: KID })
        .sign(key.privateKey);
    },
    mintHmacWithPublicKey: async (claims) => {
      const secret = new TextEncoder().encode(await exportSPKI(pair.publicKey));
      return new SignJWT(goodClaims(claims))
        .setProtectedHeader({ alg: 'HS256', kid: KID })
        .sign(secret);
    },
  };
}
