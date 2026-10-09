import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CreditsModule from '@/server/credits';
import type * as SessionsModule from '@/server/auth/sessions';
import { freshDb } from '../../helpers/db';
import { createSession, createUser } from '../../helpers/factories';
import { apiKeys, authIdentities, creditLedger, sessions, users } from '@/server/db/schema';

const failure = vi.hoisted(() => ({ after: undefined as 'grant' | 'session' | undefined }));

// The real modules, except that they can be told to blow up AFTER they have written, which is the
// nastiest moment: half of the sign-in is already in the database.
vi.mock('@/server/credits', async (importOriginal) => {
  const actual = await importOriginal<typeof CreditsModule>();
  return {
    ...actual,
    grantCredits: ((...args: Parameters<typeof actual.grantCredits>) => {
      const entry = actual.grantCredits(...args);
      if (failure.after === 'grant') throw new Error('disk full after the ledger write');
      return entry;
    }) as typeof actual.grantCredits,
  };
});

vi.mock('@/server/auth/sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionsModule>();
  return {
    ...actual,
    openSession: ((...args: Parameters<typeof actual.openSession>) => {
      const opened = actual.openSession(...args);
      if (failure.after === 'session') throw new Error('crash after the session insert');
      return opened;
    }) as typeof actual.openSession,
  };
});

import { signInWithFirebase } from '@/server/auth/firebase-login';
import { firebaseKeyFixture } from './firebase-support';
import { stubEnv, trustTestState } from './trust-support';

const harness = freshDb();
trustTestState();
const minter = firebaseKeyFixture();

beforeEach(() => {
  failure.after = undefined;
  stubEnv({
    FIREBASE_API_KEY: 'k'.repeat(30),
    FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
    FIREBASE_PROJECT_ID: 'test-project',
  });
});

const signIn = async () => signInWithFirebase({ idToken: await minter.mint(), locale: 'en' });

function counts() {
  return {
    users: harness.db.select().from(users).all().length,
    identities: harness.db.select().from(authIdentities).all().length,
    ledger: harness.db.select().from(creditLedger).all().length,
    sessions: harness.db.select().from(sessions).all().length,
  };
}

describe('a Google sign-in is one transaction', () => {
  it('leaves no user, identity, ledger row or session when the bonus grant fails after writing', async () => {
    failure.after = 'grant';
    await expect(signIn()).rejects.toThrow('disk full');
    expect(counts()).toEqual({ users: 0, identities: 0, ledger: 0, sessions: 0 });
  });

  it('leaves nothing behind when opening the session fails after user, identity and bonus exist', async () => {
    failure.after = 'session';
    await expect(signIn()).rejects.toThrow('crash after the session');
    expect(counts()).toEqual({ users: 0, identities: 0, ledger: 0, sessions: 0 });
  });

  it('succeeds afterwards, so a failed attempt does not burn the account', async () => {
    failure.after = 'grant';
    await expect(signIn()).rejects.toThrow();
    failure.after = undefined;
    const result = await signIn();
    expect(result.created).toBe(true);
    expect(result.user.creditBalance).toBe(50);
    expect(counts()).toEqual({ users: 1, identities: 1, ledger: 1, sessions: 1 });
  });

  it('keeps an unconfirmed account exactly as it was when claiming it fails halfway', async () => {
    const user = createUser(harness.db, {
      email: 'layla@example.com',
      emailCanonical: 'layla@example.com',
      passwordHash: 'the-squatters-hash',
      creditBalance: 0,
    });
    const session = createSession(harness.db, user.id);
    harness.db
      .insert(apiKeys)
      .values({
        id: 'key_test',
        userId: user.id,
        name: 'planted',
        prefix: 'avk_abcd1234',
        keyHash: 'h'.repeat(20),
        createdAt: Date.now(),
      })
      .run();

    failure.after = 'session';
    await expect(signIn()).rejects.toThrow('crash after the session');

    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    // The password, the sessions and the keys are all still there: a claim is all or nothing.
    expect(row).toMatchObject({
      passwordHash: 'the-squatters-hash',
      hasPassword: true,
      emailVerifiedAt: null,
    });
    expect(
      harness.db.select().from(sessions).where(eq(sessions.id, session.id)).all(),
    ).toHaveLength(1);
    expect(harness.db.select().from(apiKeys).all()).toMatchObject([{ revokedAt: null }]);
    expect(harness.db.select().from(authIdentities).all()).toHaveLength(0);
  });
});
