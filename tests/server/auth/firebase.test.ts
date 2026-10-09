import { SignJWT, UnsecuredJWT, base64url, errors } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  MAX_AUTH_AGE_SEC,
  MAX_ID_TOKEN_LENGTH,
  firebaseWebConfig,
  isFirebaseAuthEnabled,
  setFirebaseKeyResolver,
  verifyFirebaseIdToken,
} from '@/server/auth/firebase';
import { getLogger } from '@/server/logger';
import { ISSUER, KID, PROJECT_ID, goodClaims, firebaseKeyFixture } from './firebase-support';

const minter = firebaseKeyFixture();
const verify = (token: string, now?: Date) =>
  verifyFirebaseIdToken(token, { projectId: PROJECT_ID, ...(now ? { now } : {}) });

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

/** Every failure of the token itself looks the same to the client. */
async function expectGeneric401(promise: Promise<unknown>): Promise<void> {
  const error = await rejection(promise);
  expect(error.code).toBe('unauthorized');
  expect(error.status).toBe(401);
  expect(error.message).toBe('The Google sign-in could not be verified');
  expect(error.details).toBeUndefined();
}

describe('isFirebaseAuthEnabled / firebaseWebConfig', () => {
  const full = {
    FIREBASE_API_KEY: 'k'.repeat(30),
    FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
    FIREBASE_PROJECT_ID: PROJECT_ID,
    FIREBASE_APP_ID: undefined,
    FIREBASE_AUTH: 'auto',
  } as const;

  it('is on when the three web identifiers are set', () => {
    expect(isFirebaseAuthEnabled(full)).toBe(true);
  });

  it.each(['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID'] as const)(
    'is off without %s',
    (name) => {
      expect(isFirebaseAuthEnabled({ ...full, [name]: undefined })).toBe(false);
      expect(firebaseWebConfig({ ...full, [name]: undefined })).toBeNull();
    },
  );

  it('is off when FIREBASE_AUTH=off, however complete the settings are', () => {
    expect(isFirebaseAuthEnabled({ ...full, FIREBASE_AUTH: 'off' })).toBe(false);
    expect(firebaseWebConfig({ ...full, FIREBASE_AUTH: 'off' })).toBeNull();
  });

  it('hands the browser exactly the public identifiers, the app id only when set', () => {
    expect(firebaseWebConfig(full)).toEqual({
      apiKey: full.FIREBASE_API_KEY,
      authDomain: full.FIREBASE_AUTH_DOMAIN,
      projectId: PROJECT_ID,
    });
    expect(firebaseWebConfig({ ...full, FIREBASE_APP_ID: '1:123:web:abc' })).toEqual({
      apiKey: full.FIREBASE_API_KEY,
      authDomain: full.FIREBASE_AUTH_DOMAIN,
      projectId: PROJECT_ID,
      appId: '1:123:web:abc',
    });
  });
});

describe('verifyFirebaseIdToken', () => {
  it('accepts a good Google sign-in and returns who it vouches for', async () => {
    const identity = await verify(await minter.mint());
    expect(identity).toEqual({
      subject: 'firebase-uid-1',
      email: 'layla@example.com',
      name: 'Layla Hassan',
    });
  });

  it('lower-cases the email and leaves out an empty name', async () => {
    const identity = await verify(
      await minter.mint({ email: ' Layla.Hassan@Example.COM ', name: '  ' }),
    );
    expect(identity.email).toBe('layla.hassan@example.com');
    expect(identity.name).toBeNull();
  });

  describe('signature, issuer and audience', () => {
    it('rejects another audience (a token of a different Firebase project)', async () => {
      await expectGeneric401(verify(await minter.mint({ aud: 'other-project' })));
    });

    it('rejects another issuer', async () => {
      await expectGeneric401(
        verify(await minter.mint({ iss: 'https://securetoken.google.com/other-project' })),
      );
      await expectGeneric401(verify(await minter.mint({ iss: 'https://accounts.google.com' })));
    });

    it('rejects an expired token', async () => {
      const now = Math.floor(Date.now() / 1000);
      await expectGeneric401(
        verify(await minter.mint({ iat: now - 7200, auth_time: now - 7200, exp: now - 3600 })),
      );
    });

    it('rejects a token signed by a key Google never published', async () => {
      await expectGeneric401(verify(await minter.mintWithStrangerKey()));
    });

    it('rejects an unknown key id', async () => {
      await expectGeneric401(verify(await minter.mint({}, { kid: 'rotated-away' })));
    });

    it('rejects a token whose payload was changed after signing', async () => {
      const [header, , signature] = (await minter.mint({ email: 'a@example.com' })).split('.');
      const forged = base64url.encode(
        JSON.stringify(goodClaims({ email: 'victim@example.com', sub: 'firebase-uid-1' })),
      );
      await expectGeneric401(verify(`${header}.${forged}.${signature}`));
    });

    it('rejects "alg: none"', async () => {
      const unsigned = new UnsecuredJWT(goodClaims()).encode();
      await expectGeneric401(verify(unsigned));
      // The same, with a kid and an empty signature part dressed up as a normal token.
      const [, payload] = unsigned.split('.');
      const header = base64url.encode(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KID }));
      await expectGeneric401(verify(`${header}.${payload}.`));
    });

    it('rejects HMAC tokens (the public key used as a shared secret)', async () => {
      const secret = new TextEncoder().encode('s'.repeat(48));
      for (const alg of ['HS256', 'HS384', 'HS512']) {
        const token = await new SignJWT(goodClaims())
          .setProtectedHeader({ alg, kid: KID })
          .sign(secret);
        await expectGeneric401(verify(token));
      }
    });

    it('accepts RS256 only: a validly signed RS384, RS512 or PS256 token is refused', async () => {
      for (const alg of ['RS384', 'RS512', 'PS256'] as const) {
        await expectGeneric401(verify(await minter.mintWithAlgorithm(alg)));
      }
    });

    it('is not fooled by an HMAC token keyed with the public key (algorithm confusion)', async () => {
      await expectGeneric401(verify(await minter.mintHmacWithPublicKey()));
    });

    it('accepts RS256 only: other algorithm headers are refused before any key is used', async () => {
      const resolver = vi.fn(async () => {
        throw new Error('the key lookup must not be reached');
      });
      setFirebaseKeyResolver(resolver);
      for (const alg of ['RS384', 'RS512', 'PS256', 'ES256']) {
        const header = base64url.encode(JSON.stringify({ alg, kid: KID }));
        const payload = base64url.encode(JSON.stringify(goodClaims()));
        await expectGeneric401(verify(`${header}.${payload}.${base64url.encode('sig')}`));
      }
      expect(resolver).not.toHaveBeenCalled();
    });

    it.each(['', 'not a jwt', 'a.b', 'a.b.c', 'a.b.c.d.e', '....'])(
      'rejects the garbage %j',
      async (garbage) => {
        await expectGeneric401(verify(garbage));
      },
    );

    it('rejects a non-string argument', async () => {
      await expectGeneric401(verify(undefined as unknown as string));
      await expectGeneric401(verify(12345 as unknown as string));
    });
  });

  describe('Firebase claims', () => {
    it('rejects a missing or empty sub, and one over 128 characters', async () => {
      await expectGeneric401(verify(await minter.mint({ sub: undefined })));
      await expectGeneric401(verify(await minter.mint({ sub: '' })));
      await expectGeneric401(verify(await minter.mint({ sub: 'u'.repeat(129) })));
      await expect(verify(await minter.mint({ sub: 'u'.repeat(128) }))).resolves.toMatchObject({
        subject: 'u'.repeat(128),
      });
    });

    it('rejects a sub that is not a string', async () => {
      await expectGeneric401(verify(await minter.mint({ sub: 12345 })));
    });

    it('rejects auth_time in the future, missing, or not a number', async () => {
      const now = Math.floor(Date.now() / 1000);
      await expectGeneric401(verify(await minter.mint({ auth_time: now + 3600 })));
      await expectGeneric401(verify(await minter.mint({ auth_time: undefined })));
      await expectGeneric401(verify(await minter.mint({ auth_time: String(now) })));
    });

    it('rejects an iat in the future', async () => {
      const now = Math.floor(Date.now() / 1000);
      await expectGeneric401(verify(await minter.mint({ iat: now + 3600 })));
    });

    it('tolerates a few seconds of clock difference, not minutes', async () => {
      const now = Math.floor(Date.now() / 1000);
      await expect(
        verify(await minter.mint({ iat: now + 10, auth_time: now + 10 })),
      ).resolves.toBeDefined();
      await expectGeneric401(verify(await minter.mint({ iat: now + 120, auth_time: now + 120 })));
    });

    it('rejects a sign-in that is older than the freshness window (a replayed, stolen token)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const stale = now - MAX_AUTH_AGE_SEC - 120;
      // Still inside the hour Firebase gives the token, but the person signed in long ago.
      await expectGeneric401(verify(await minter.mint({ auth_time: stale, iat: now - 5 })));
      await expect(
        verify(await minter.mint({ auth_time: now - MAX_AUTH_AGE_SEC + 60 })),
      ).resolves.toBeDefined();
    });

    it.each([
      ['password', 'password'],
      ['anonymous', 'anonymous'],
      ['custom', 'custom'],
      ['phone', 'phone'],
      ['facebook', 'facebook.com'],
      ['apple', 'apple.com'],
      ['github', 'github.com'],
      ['a Google look-alike', 'google.com.evil'],
      ['an empty provider', ''],
    ])('refuses the %s provider', async (_label, provider) => {
      await expectGeneric401(
        verify(await minter.mint({ firebase: { sign_in_provider: provider } })),
      );
    });

    it('refuses a token without the firebase claim, or with a malformed one', async () => {
      await expectGeneric401(verify(await minter.mint({ firebase: undefined })));
      await expectGeneric401(verify(await minter.mint({ firebase: 'google.com' })));
      await expectGeneric401(verify(await minter.mint({ firebase: null })));
      await expectGeneric401(verify(await minter.mint({ firebase: {} })));
    });

    it('refuses a missing email or one that is not a string', async () => {
      await expectGeneric401(verify(await minter.mint({ email: undefined })));
      await expectGeneric401(verify(await minter.mint({ email: '' })));
      await expectGeneric401(verify(await minter.mint({ email: 42 })));
    });

    it('refuses an email Google did not verify, in every spelling of "not true"', async () => {
      await expectGeneric401(verify(await minter.mint({ email_verified: false })));
      await expectGeneric401(verify(await minter.mint({ email_verified: undefined })));
      await expectGeneric401(verify(await minter.mint({ email_verified: 'true' })));
      await expectGeneric401(verify(await minter.mint({ email_verified: 1 })));
    });
  });

  describe('size', () => {
    it('refuses an oversize token without parsing it', async () => {
      const resolver = vi.fn(async () => {
        throw new Error('the key lookup must not be reached');
      });
      setFirebaseKeyResolver(resolver);
      const huge = await minter.mint({ padding: 'x'.repeat(MAX_ID_TOKEN_LENGTH) });
      expect(huge.length).toBeGreaterThan(MAX_ID_TOKEN_LENGTH);
      await expectGeneric401(verify(huge));
      await expectGeneric401(verify('a'.repeat(MAX_ID_TOKEN_LENGTH + 1)));
      expect(resolver).not.toHaveBeenCalled();
    });

    it('accepts a normal token, which is far below the cap', async () => {
      const token = await minter.mint();
      expect(token.length).toBeLessThan(MAX_ID_TOKEN_LENGTH / 2);
    });
  });

  describe('clock', () => {
    it('uses the clock it is given for expiry', async () => {
      const token = await minter.mint();
      const later = new Date(Date.now() + 2 * 3600 * 1000);
      await expectGeneric401(verify(token, later));
    });
  });

  describe('Google keys not available', () => {
    it('answers 503 service_busy, not 401, when the key set cannot be loaded', async () => {
      setFirebaseKeyResolver(async () => {
        throw new TypeError('fetch failed');
      });
      const error = await rejection(verify(await minter.mint()));
      expect(error.code).toBe('service_busy');
      expect(error.status).toBe(503);
      expect(JSON.stringify(error.details)).not.toMatch(/fetch|google/i);
    });

    it('does the same for a timeout and for a refused key set', async () => {
      for (const failure of [new errors.JWKSTimeout(), new errors.JOSEError('Expected 200 OK')]) {
        setFirebaseKeyResolver(async () => {
          throw failure;
        });
        expect((await rejection(verify(await minter.mint()))).status).toBe(503);
      }
    });
  });

  describe('logging', () => {
    it('logs the reason class and never the token', async () => {
      const info = vi.spyOn(getLogger(), 'info');
      const token = await minter.mint({ aud: 'other-project' });
      await rejection(verify(token));
      const logged = JSON.stringify(info.mock.calls);
      expect(logged).toContain('claim_aud');
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(token.split('.')[1] ?? 'missing');
    });
  });

  it('checks the issuer of the project it is told about', async () => {
    const token = await minter.mint({ iss: ISSUER, aud: PROJECT_ID });
    await expect(
      verifyFirebaseIdToken(token, { projectId: 'another-project' }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
