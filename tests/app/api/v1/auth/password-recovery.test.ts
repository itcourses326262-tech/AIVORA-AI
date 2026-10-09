import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as forgotRoute } from '@/app/api/v1/auth/password/forgot/route';
import { POST as resetRoute } from '@/app/api/v1/auth/password/reset/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { flushBackground } from '@/server/auth/background';
import { RESET_MAIL_BUDGET } from '@/server/auth/password-reset';
import { issueEmailToken } from '@/server/auth/email-tokens';
import { verifyPassword } from '@/server/auth/password';
import { creditLedger, emailTokens, sessions, users } from '@/server/db/schema';
import { getOutbox } from '@/server/email';
import { setRateLimiter, type RateLimiter } from '@/server/security/rate-limit';
import { cleanEmailState, linkIn, mailTo } from '../../../../server/email/support';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { GOOD_PASSWORD, passwordFixture } from '../../../../server/auth/trust-support';
import { browser, routeTestState, stubEnv, type ErrorBody } from './support';

const harness = freshDb();
const fixture = passwordFixture();
routeTestState();
cleanEmailState();

const FORGOT_URL = '/api/v1/auth/password/forgot';
const RESET_URL = '/api/v1/auth/password/reset';
const NEW_PASSWORD = 'a completely different passphrase 42';

type Body = { data: Record<string, unknown> } & ErrorBody;

function forgot(body: unknown, headers: Record<string, string> = browser()) {
  return invokeRoute<Body>(forgotRoute, { url: FORGOT_URL, method: 'POST', body, headers });
}

function reset(body: unknown, headers: Record<string, string> = browser()) {
  return invokeRoute<Body>(resetRoute, { url: RESET_URL, method: 'POST', body, headers });
}

function account(overrides: Partial<typeof users.$inferInsert> = {}) {
  return createUser(harness.db, {
    email: 'layla@example.com',
    name: 'Layla',
    locale: 'en',
    passwordHash: fixture.hash,
    ...overrides,
  });
}

/** Everything about a response a client could compare, minus what is unique per request. */
function fingerprint(result: Awaited<ReturnType<typeof forgot>>) {
  const headers: Record<string, string> = {};
  for (const [name, value] of result.headers) {
    if (name === 'x-request-id' || name === 'x-ratelimit-reset') continue;
    headers[name] = value;
  }
  return { status: result.status, text: result.text, headers };
}

describe('POST /api/v1/auth/password/forgot', () => {
  it('answers 202 {accepted:true} and mails the owner a reset link', async () => {
    const user = account();
    const result = await forgot({ email: 'layla@example.com' });
    expect(result.status).toBe(202);
    expect(result.json.data).toEqual({ accepted: true });
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(result.headers.get('cache-control')).toBe('no-store');

    await flushBackground();
    const mail = await mailTo('layla@example.com');
    expect(mail).toMatchObject({ kind: 'password_reset' });
    const { url } = linkIn(mail);
    expect(url.pathname).toBe('/reset-password');
    expect(
      harness.db.select().from(emailTokens).where(eq(emailTokens.userId, user.id)).all(),
    ).toHaveLength(1);
    // Nothing in the response can be used to reset anything.
    expect(result.text).not.toContain(linkIn(mail).token);
  });

  describe('enumeration resistance', () => {
    it('gives the same response for a known account, an unknown one, a disabled one and a deleted one', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      account();
      createUser(harness.db, { email: 'disabled@example.com', disabledAt: Date.now() });
      createUser(harness.db, { email: 'deleted@example.com', deletedAt: Date.now() });
      const from = (n: number) => browser(undefined, { 'x-forwarded-for': `198.51.100.${n}` });

      const known = fingerprint(await forgot({ email: 'layla@example.com' }, from(1)));
      const unknown = fingerprint(await forgot({ email: 'nobody@example.com' }, from(2)));
      const disabled = fingerprint(await forgot({ email: 'disabled@example.com' }, from(3)));
      const deleted = fingerprint(await forgot({ email: 'deleted@example.com' }, from(4)));

      expect(known.status).toBe(202);
      expect(unknown).toEqual(known);
      expect(disabled).toEqual(known);
      expect(deleted).toEqual(known);

      // Only the real account got mail.
      await flushBackground();
      await mailTo('layla@example.com');
      expect(getOutbox().map((entry) => entry.to)).toEqual(['layla@example.com']);
    });

    it('answers a malformed address with the same validation error whoever owns what', async () => {
      account();
      const a = await forgot({ email: 'not-an-email' });
      const b = await forgot({ email: '' });
      expect(a.status).toBe(422);
      expect(b.status).toBe(422);
      expect(a.json.error.code).toBe('validation_failed');
    });

    it('takes about as long for a known account as for an unknown one', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      const known: number[] = [];
      const unknown: number[] = [];
      for (let round = 0; round < 12; round += 1) {
        account({ email: `known${round}@example.com` });
        const headers = browser(undefined, { 'x-forwarded-for': `198.51.100.${round + 10}` });
        const t0 = performance.now();
        await forgot({ email: `known${round}@example.com` }, headers);
        const t1 = performance.now();
        await forgot(
          { email: `unknown${round}@example.com` },
          browser(undefined, { 'x-forwarded-for': `198.51.101.${round + 10}` }),
        );
        const t2 = performance.now();
        known.push(t1 - t0);
        unknown.push(t2 - t1);
      }
      await flushBackground();
      const median = (values: number[]) =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
      // Both are a request parse and a counter bump; the lookup, the token and the mail come after.
      expect(Math.abs(median(known) - median(unknown))).toBeLessThan(25);
    });

    it('does not do the account work before answering', async () => {
      account();
      await forgot({ email: 'layla@example.com' });
      // The response is out, the lookup and the token have not even run yet.
      expect(harness.db.select().from(emailTokens).all()).toEqual([]);
      await flushBackground();
      expect(harness.db.select().from(emailTokens).all()).toHaveLength(1);
    });

    it('keeps answering 202 once the per-account mail budget is spent, and sends nothing', async () => {
      account();
      const denied: RateLimiter = {
        hit: (key, limit, windowSec) => ({
          allowed: !key.startsWith(`${RESET_MAIL_BUDGET.name}:`),
          remaining: 0,
          resetAt: Date.now() + windowSec * 1000 + limit,
        }),
      };
      setRateLimiter(denied);
      const result = await forgot({ email: 'layla@example.com' });
      expect(result.status).toBe(202);
      expect(result.json.data).toEqual({ accepted: true });
      await flushBackground();
      await mailTo('layla@example.com');
      expect(getOutbox()).toEqual([]);
    });
  });

  describe('limits', () => {
    it('spends the mail budget per ACCOUNT and only when a mail goes out: made-up addresses cost nothing', async () => {
      const keys: Array<{ key: string; limit: number; windowSec: number }> = [];
      setRateLimiter({
        hit: (key, limit, windowSec) => {
          keys.push({ key, limit, windowSec });
          return { allowed: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
        },
      });
      const mailBudget = () => keys.filter((entry) => entry.key.startsWith(RESET_MAIL_BUDGET.name));

      // Nobody owns this mailbox: nothing is spent, however many aliases are tried.
      await forgot({ email: 'A.B+one@Gmail.com' });
      await forgot({ email: 'ab+two@gmail.com' });
      await flushBackground();
      expect(mailBudget()).toEqual([]);

      // Once it has an owner, an alias request reaches that account and spends ITS budget (3 an hour).
      const owner = account({ email: 'ab@gmail.com', emailCanonical: 'ab@gmail.com' });
      await forgot({ email: 'A.B+one@Gmail.com' });
      await flushBackground();
      expect(mailBudget()).toMatchObject([
        { key: `auth-reset-mail:${owner.id}`, limit: 3, windowSec: 3600 },
      ]);
      await mailTo('ab@gmail.com');
      expect(getOutbox().map((entry) => entry.to)).toEqual(['ab@gmail.com']);
    });

    it('limits each client address to 10 an hour behind a proxy', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      const from = (address: string) => browser(undefined, { 'x-forwarded-for': address });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect(
          (await forgot({ email: `u${attempt}@example.com` }, from('198.51.100.1'))).status,
        ).toBe(202);
      }
      const blocked = await forgot({ email: 'u11@example.com' }, from('198.51.100.1'));
      expect(blocked.status).toBe(429);
      expect(blocked.json.error.code).toBe('rate_limited');
      expect(blocked.headers.get('retry-after')).not.toBeNull();
      expect((await forgot({ email: 'u12@example.com' }, from('198.51.100.2'))).status).toBe(202);
    });

    it('uses one large shared budget when clients cannot be told apart', async () => {
      const result = await forgot({ email: 'u@example.com' });
      expect(result.headers.get('x-ratelimit-limit')).toBe('300');
    });
  });

  describe('cross-site abuse', () => {
    it.each([
      ['a foreign origin', { origin: 'https://evil.example' }],
      ['no origin at all', {}],
      ['a null origin', { origin: 'null' }],
    ])("refuses %s and does not even spend the visitor's budget", async (_label, headers) => {
      account();
      const result = await forgot({ email: 'layla@example.com' }, headers);
      expect(result.status).toBe(403);
      expect(result.headers.get('x-ratelimit-limit')).toBeNull();
      await flushBackground();
      expect(getOutbox()).toEqual([]);
    });
  });

  it('builds the link from APP_URL, whatever Host or forwarding headers say', async () => {
    account();
    await forgot(
      { email: 'layla@example.com' },
      browser(undefined, {
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http',
      }),
    );
    await flushBackground();
    const { url } = linkIn(await mailTo('layla@example.com'));
    expect(url.origin).toBe('http://localhost:3000');
  });

  it('refuses a body that is not JSON, or too large', async () => {
    expect(
      (await forgot('email=a@b.co', { ...browser(), 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect((await forgot({ email: `${'a'.repeat(9000)}@example.com` })).status).toBe(413);
  });
});

describe('POST /api/v1/auth/password/reset', () => {
  function withLink() {
    const user = account();
    const { secret } = issueEmailToken(harness.db, user.id, 'reset');
    return { user, secret };
  }

  it('sets the password, signs out every device and leaves the caller to log in again', async () => {
    const { user, secret } = withLink();
    const old = createSession(harness.db, user.id);

    const result = await reset({ token: secret, password: NEW_PASSWORD });
    expect(result.status).toBe(204);
    expect(result.headers.get('set-cookie')).toBeNull();

    const hash =
      harness.db.select().from(users).where(eq(users.id, user.id)).get()?.passwordHash ?? '';
    expect(await verifyPassword(NEW_PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(GOOD_PASSWORD, hash)).toBe(false);
    expect(harness.db.select().from(sessions).where(eq(sessions.userId, user.id)).all()).toEqual(
      [],
    );
    const whoami = await invokeRoute<{ data: unknown }>(me, {
      url: '/api/v1/auth/me',
      headers: { cookie: old.cookie },
    });
    expect(whoami.json.data).toBeNull();

    const notice = await mailTo('layla@example.com');
    expect(notice?.kind).toBe('password_changed');
  });

  it('works once: the replay is a 400 "used"', async () => {
    const { secret } = withLink();
    expect((await reset({ token: secret, password: NEW_PASSWORD })).status).toBe(204);
    const replay = await reset({ token: secret, password: 'another good passphrase 7' });
    expect(replay.status).toBe(400);
    expect(replay.json.error).toMatchObject({ code: 'bad_request', details: { reason: 'used' } });
  });

  it('says "invalid" and "expired" for the links that cannot work', async () => {
    const user = account();
    const old = issueEmailToken(harness.db, user.id, 'reset', Date.now() - 2 * 3600 * 1000);
    expect((await reset({ token: old.secret, password: NEW_PASSWORD })).json.error.details).toEqual(
      { reason: 'expired' },
    );
    expect(
      (await reset({ token: 'x'.repeat(43), password: NEW_PASSWORD })).json.error.details,
    ).toEqual({ reason: 'invalid' });
  });

  it('refuses a weak password with 422 at "password" and keeps the link alive', async () => {
    const { secret } = withLink();
    const weak = await reset({ token: secret, password: 'password' });
    expect(weak.status).toBe(422);
    expect(weak.json.error.code).toBe('validation_failed');
    expect(weak.json.error.details).toMatchObject({ issues: [{ path: 'password' }] });
    expect((await reset({ token: secret, password: NEW_PASSWORD })).status).toBe(204);
  });

  it.each([
    ['a foreign origin', { origin: 'https://evil.example' }],
    ['no origin', {}],
  ])('refuses %s without touching the link or the budget', async (_label, headers) => {
    const { secret } = withLink();
    const result = await reset({ token: secret, password: NEW_PASSWORD }, headers);
    expect(result.status).toBe(403);
    expect(result.headers.get('x-ratelimit-limit')).toBeNull();
    expect((await reset({ token: secret, password: NEW_PASSWORD })).status).toBe(204);
  });

  it('has no shared budget when clients cannot be told apart: junk from anyone never locks out a real link', async () => {
    const { secret } = withLink();
    for (let attempt = 0; attempt < 700; attempt += 1) {
      const junk = await reset({ token: 'nope', password: NEW_PASSWORD });
      expect(junk.status).toBe(400);
      expect(junk.headers.get('x-ratelimit-limit')).toBeNull();
    }
    expect((await reset({ token: secret, password: NEW_PASSWORD })).status).toBe(204);
  });

  it('is bounded per client address: 10 guesses an hour behind a proxy', async () => {
    stubEnv({ TRUST_PROXY: 'true' });
    const from = (address: string) => browser(undefined, { 'x-forwarded-for': address });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        (await reset({ token: 'nope', password: NEW_PASSWORD }, from('198.51.100.1'))).status,
      ).toBe(400);
    }
    expect(
      (await reset({ token: 'nope', password: NEW_PASSWORD }, from('198.51.100.1'))).status,
    ).toBe(429);
  });

  it('rejects incomplete bodies', async () => {
    expect((await reset({ token: 'abc' })).status).toBe(422);
    expect((await reset({ password: NEW_PASSWORD })).status).toBe(422);
    expect((await reset(undefined)).status).toBe(422);
  });

  it('confirms the mailbox it was mailed to, which releases a pending sign-up bonus once', async () => {
    const { user, secret } = withLink();
    await reset({ token: secret, password: NEW_PASSWORD });
    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row?.emailVerifiedAt).toBeGreaterThan(0);
    expect(
      harness.db
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.userId, user.id))
        .all()
        .filter((e) => e.reason === 'signup_bonus'),
    ).toHaveLength(1);
  });
});
