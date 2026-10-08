import { describe, expect, it, vi } from 'vitest';
import { freshDb } from '../../helpers/db';
import { creditLedger, sessions, users } from '@/server/db/schema';

const failure = vi.hoisted(() => ({ after: undefined as 'grant' | 'session' | undefined }));

// The real credits module, except that it can be told to blow up AFTER it has written, which is
// the nastiest moment: half of the registration is already in the database.
vi.mock('@/server/credits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/credits')>();
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
  const actual = await importOriginal<typeof import('@/server/auth/sessions')>();
  return {
    ...actual,
    openSession: ((...args: Parameters<typeof actual.openSession>) => {
      const opened = actual.openSession(...args);
      if (failure.after === 'session') throw new Error('crash after the session insert');
      return opened;
    }) as typeof actual.openSession,
  };
});

import { registerUser } from '@/server/auth/users';
import { GOOD_PASSWORD, useCleanSecurityState } from './support';

const harness = freshDb();
useCleanSecurityState();

function counts() {
  return {
    users: harness.db.select().from(users).all().length,
    ledger: harness.db.select().from(creditLedger).all().length,
    sessions: harness.db.select().from(sessions).all().length,
  };
}

const input = {
  email: 'atomic@example.com',
  password: GOOD_PASSWORD,
  name: 'Atomic',
  locale: 'en' as const,
};

describe('registration is one transaction', () => {
  it('leaves no user, ledger row or session when the bonus grant fails after writing', async () => {
    failure.after = 'grant';
    await expect(registerUser(input)).rejects.toThrow('disk full');
    expect(counts()).toEqual({ users: 0, ledger: 0, sessions: 0 });
  });

  it('leaves nothing behind when opening the session fails after the user and bonus exist', async () => {
    failure.after = 'session';
    await expect(registerUser(input)).rejects.toThrow('crash after the session');
    expect(counts()).toEqual({ users: 0, ledger: 0, sessions: 0 });
  });

  it('succeeds afterwards with the same email, so a failed attempt does not burn it', async () => {
    failure.after = 'grant';
    await expect(registerUser(input)).rejects.toThrow();
    failure.after = undefined;
    const result = await registerUser(input);
    expect(result.user.creditBalance).toBe(50);
    expect(counts()).toEqual({ users: 1, ledger: 1, sessions: 1 });
  });
});
