import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  RESET_MAIL_BUDGET,
  RESET_MIN_GAP_MS,
  requestPasswordReset,
  resetPassword,
} from '@/server/auth/password-reset';
import { resolveSession } from '@/server/auth/sessions';
import { loginUser, registerUser } from '@/server/auth/users';
import { emailTokens, users } from '@/server/db/schema';
import { getOutbox } from '@/server/email';
import { setRateLimiter, type RateLimiter } from '@/server/security/rate-limit';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import { GOOD_PASSWORD, linkIn, mailTo, passwordFixture, trustTestState } from './trust-support';

const harness = freshDb();
const fixture = passwordFixture();
trustTestState();

const NEW_PASSWORD = 'a completely different passphrase 42';
const HOUR_MS = 3_600_000;

function account(email: string) {
  return createUser(harness.db, {
    email,
    name: 'Victim',
    locale: 'en',
    passwordHash: fixture.hash,
  });
}

const resetMails = (to: string) =>
  getOutbox().filter((entry) => entry.to === to && entry.kind === 'password_reset');

describe('the reset finds the account by MAILBOX and mails the address on file', () => {
  it.each([
    ['plus tag', 'victim+a@gmail.com'],
    ['dots', 'v.ictim@gmail.com'],
    ['googlemail', 'victim@googlemail.com'],
    ['dots, tag and case', ' V.Ictim+Spam@GMAIL.com '],
  ])('an alias request (%s) reaches the owner of victim@gmail.com', async (_label, typed) => {
    account('victim@gmail.com');
    // Stored the way registration stores it: the canonical column is filled.
    harness.db
      .update(users)
      .set({ emailCanonical: 'victim@gmail.com' })
      .where(eq(users.email, 'victim@gmail.com'))
      .run();
    expect(requestPasswordReset(typed)).toBe(true);
    await mailTo('victim@gmail.com');
    expect(resetMails('victim@gmail.com')).toHaveLength(1);
    // Nothing goes to the alias the requester typed.
    expect(getOutbox().map((entry) => entry.to)).toEqual(['victim@gmail.com']);
  });

  it('prefers the exact address when two accounts could match (rows from before the canonical column)', async () => {
    account('a.b@gmail.com');
    account('ab@gmail.com');
    expect(requestPasswordReset('a.b@gmail.com')).toBe(true);
    await mailTo('a.b@gmail.com');
    expect(getOutbox().map((entry) => entry.to)).toEqual(['a.b@gmail.com']);
  });

  it('still sends nothing for a mailbox nobody registered', async () => {
    account('victim@gmail.com');
    expect(requestPasswordReset('stranger+x@gmail.com')).toBe(false);
    await mailTo('victim@gmail.com');
    expect(getOutbox()).toEqual([]);
  });
});

describe('the per-account mail budget is spent only when a mail really goes out', () => {
  it('requests that match no account spend nothing, so they cannot starve a real one', () => {
    const keys: string[] = [];
    const spy: RateLimiter = {
      hit: (key, limit, windowSec) => {
        keys.push(key);
        return { allowed: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
      },
    };
    setRateLimiter(spy);
    account('victim@gmail.com');
    for (const typed of ['nobody@example.com', 'x+1@gmail.com', 'x+2@gmail.com', '']) {
      expect(requestPasswordReset(typed)).toBe(false);
    }
    expect(keys).toEqual([]);
  });

  it('requests blocked by the 60 s gap spend nothing either', async () => {
    const hits: string[] = [];
    setRateLimiter({
      hit: (key, limit, windowSec) => {
        hits.push(key);
        return { allowed: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
      },
    });
    const user = account('victim@gmail.com');
    const now = Date.now();
    expect(requestPasswordReset('victim@gmail.com', now)).toBe(true);
    for (let i = 1; i <= 20; i += 1) {
      expect(requestPasswordReset(`victim+${i}@gmail.com`, now + i)).toBe(false);
    }
    expect(hits).toEqual([`${RESET_MAIL_BUDGET.name}:${user.id}`]);
  });

  it('allows 3 mails an hour per account and then stays silent, other accounts are unaffected', async () => {
    account('victim@gmail.com');
    account('other@example.com');
    const t0 = Date.now();
    const results = [0, 1, 2, 3, 4].map((step) =>
      requestPasswordReset('victim@gmail.com', t0 + step * RESET_MIN_GAP_MS),
    );
    expect(results).toEqual([true, true, true, false, false]);
    expect(requestPasswordReset('other@example.com', t0 + 5 * RESET_MIN_GAP_MS)).toBe(true);
    await mailTo('victim@gmail.com');
    expect(resetMails('victim@gmail.com')).toHaveLength(3);
  });

  it('an attacker who floods alias requests cannot leave the owner without a usable link', async () => {
    account('victim@gmail.com');
    harness.db
      .update(users)
      .set({ emailCanonical: 'victim@gmail.com' })
      .where(eq(users.email, 'victim@gmail.com'))
      .run();
    const now = Date.now();
    // Three alias requests (the ones that used to burn the owner's budget without sending anything) ...
    for (const typed of ['victim+a@gmail.com', 'v.ictim@gmail.com', 'victim+c@gmail.com']) {
      requestPasswordReset(typed, now);
    }
    // ... and then the owner's own request, in the same minute.
    requestPasswordReset('victim@gmail.com', now + 1_000);

    // A real, working link is in the owner's inbox either way.
    const mail = await mailTo('victim@gmail.com');
    expect(mail).toMatchObject({ kind: 'password_reset' });
    await resetPassword(linkIn(mail).token, NEW_PASSWORD);
    await expect(
      loginUser({ email: 'victim@gmail.com', password: NEW_PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('the budget window passes: the next hour starts afresh', async () => {
    account('victim@gmail.com');
    const t0 = Date.now();
    for (let step = 0; step < 3; step += 1) {
      requestPasswordReset('victim@gmail.com', t0 + step * RESET_MIN_GAP_MS);
    }
    expect(requestPasswordReset('victim@gmail.com', t0 + 3 * RESET_MIN_GAP_MS)).toBe(false);
    // The limiter measures real time, so a new window is simulated with a fresh limiter.
    setRateLimiter(null);
    expect(requestPasswordReset('victim@gmail.com', t0 + HOUR_MS + RESET_MIN_GAP_MS)).toBe(true);
    expect(harness.db.select().from(emailTokens).all()).toHaveLength(4);
  });
});

describe('an unconfirmed alias registration does not lock the real mailbox owner out for good', () => {
  it('the owner recovers the squatted account through the reset, which evicts the squatter', async () => {
    // The squatter takes an alias of the victim's mailbox ...
    const squatter = await registerUser({
      email: 'victim+x@gmail.com',
      password: GOOD_PASSWORD,
      name: 'Squatter',
      locale: 'en',
    });
    // ... so the victim's own registration is refused (the generic conflict).
    await expect(
      registerUser({
        email: 'victim@gmail.com',
        password: NEW_PASSWORD,
        name: 'Victim',
        locale: 'en',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    // The way back is the reset: it finds the account by mailbox and mails the address on file,
    // which is the victim's own inbox.
    expect(requestPasswordReset('victim@gmail.com')).toBe(true);
    const mail = await mailTo('victim+x@gmail.com');
    expect(mail).toMatchObject({ kind: 'password_reset', to: 'victim+x@gmail.com' });
    await resetPassword(linkIn(mail).token, NEW_PASSWORD);

    expect(resolveSession(squatter.token, harness.db)).toBeNull();
    await expect(
      loginUser({ email: 'victim+x@gmail.com', password: GOOD_PASSWORD }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      loginUser({ email: 'victim+x@gmail.com', password: NEW_PASSWORD }),
    ).resolves.toMatchObject({ user: { id: squatter.user.id } });
  });
});
