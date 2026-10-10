import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import * as confirmModule from '@/app/api/v1/auth/verify-email/confirm/route';
import * as requestModule from '@/app/api/v1/auth/verify-email/request/route';
import { createApiKey } from '@/server/auth/api-keys';
import { issueEmailToken } from '@/server/auth/email-tokens';
import { creditLedger, emailTokens, users } from '@/server/db/schema';
import { getOutbox } from '@/server/email';
import { setRateLimiter, type RateLimiter } from '@/server/security/rate-limit';
import { cleanEmailState, linkIn, mailTo } from '../../../../server/email/support';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { browser, routeTestState, stubEnv, type ErrorBody } from './support';

const harness = freshDb();
routeTestState();
// The bonus assertions in this file are about a setup where password accounts earn it
// (SIGNUP_BONUS_PROVIDER=any, the suite default); who earns it is google-only-bonus.test.ts.
beforeEach(() => stubEnv({ SIGNUP_BONUS_PROVIDER: 'any' }));
cleanEmailState();

const REQUEST_URL = '/api/v1/auth/verify-email/request';
const CONFIRM_URL = '/api/v1/auth/verify-email/confirm';

type Body = { data: Record<string, unknown> } & ErrorBody;

function requestLink(headers: Record<string, string>) {
  return invokeRoute<Body>(requestModule.POST, { url: REQUEST_URL, method: 'POST', headers });
}

function confirm(body: unknown, headers: Record<string, string> = {}) {
  return invokeRoute<Body>(confirmModule.POST, { url: CONFIRM_URL, method: 'POST', body, headers });
}

function unconfirmed() {
  const user = createUser(harness.db, {
    email: 'layla@example.com',
    name: 'Layla',
    locale: 'en',
    creditBalance: 0,
    emailVerifiedAt: null,
  });
  return { user, session: createSession(harness.db, user.id) };
}

describe('POST /api/v1/auth/verify-email/request', () => {
  it('needs a login', async () => {
    const result = await requestLink({ origin: 'http://localhost:3000' });
    expect(result.status).toBe(401);
    expect(result.json.error.code).toBe('unauthorized');
  });

  it('answers 202 and mails a link that is not in the response', async () => {
    const { session } = unconfirmed();
    const result = await requestLink(session.headers);
    expect(result.status).toBe(202);
    expect(result.json.data).toEqual({ sent: true, verified: false, resendAfterSec: 60 });
    expect(result.headers.get('cache-control')).toBe('no-store');
    const mail = await mailTo('layla@example.com');
    const { token } = linkIn(mail);
    expect(result.text).not.toContain(token);
    expect(result.text).not.toMatch(/token/i);
  });

  it('answers a second request within a minute with 429, Retry-After and the wait', async () => {
    const { session } = unconfirmed();
    expect((await requestLink(session.headers)).status).toBe(202);
    const again = await requestLink(session.headers);
    expect(again.status).toBe(429);
    expect(again.json.error.code).toBe('rate_limited');
    const wait = (again.json.error.details as { retryAfterSec: number }).retryAfterSec;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    expect(again.headers.get('retry-after')).toBe(String(wait));
    await mailTo('layla@example.com');
    expect(getOutbox()).toHaveLength(1);
  });

  it('tells a confirmed account there is nothing to send (200, sent false)', async () => {
    const user = createUser(harness.db, { emailVerifiedAt: Date.now() });
    const session = createSession(harness.db, user.id);
    const result = await requestLink(session.headers);
    expect(result.status).toBe(200);
    expect(result.json.data).toEqual({ sent: false, verified: true, resendAfterSec: 0 });
    expect(getOutbox()).toEqual([]);
  });

  it('works for an API key too, and sends the link to the key owner only', async () => {
    const { user } = unconfirmed();
    const { key } = await createApiKey(user.id, 'ci');
    const result = await invokeRoute<Body>(requestModule.POST, {
      url: REQUEST_URL,
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(result.status).toBe(202);
    expect((await mailTo('layla@example.com'))?.to).toBe('layla@example.com');
  });

  it('is protected against cross-site requests when a cookie is used', async () => {
    const { session } = unconfirmed();
    const result = await requestLink({ cookie: session.cookie, origin: 'https://evil.example' });
    expect(result.status).toBe(403);
    expect(await mailTo('layla@example.com')).toBeUndefined();
  });

  it('is limited per account: 6 an hour', async () => {
    const hits: Array<{ key: string; limit: number; windowSec: number }> = [];
    const limiter: RateLimiter = {
      hit: (key, limit, windowSec) => {
        hits.push({ key, limit, windowSec });
        return { allowed: true, remaining: limit - 1, resetAt: Date.now() + windowSec * 1000 };
      },
    };
    setRateLimiter(limiter);
    const { user, session } = unconfirmed();
    await requestLink(session.headers);
    expect(hits).toContainEqual({
      key: `auth-verify-request:user:${user.id}`,
      limit: 6,
      windowSec: 3600,
    });
  });

  it("cannot be used for somebody else's account: it only ever acts on the caller", async () => {
    const { session } = unconfirmed();
    const other = createUser(harness.db, { email: 'other@example.com', emailVerifiedAt: null });
    const result = await invokeRoute<Body>(requestModule.POST, {
      url: `${REQUEST_URL}?userId=${other.id}`,
      method: 'POST',
      body: { userId: other.id, email: 'other@example.com' },
      headers: session.headers,
    });
    expect(result.status).toBe(202);
    expect(await mailTo('other@example.com')).toBeUndefined();
    expect(
      harness.db.select().from(emailTokens).where(eq(emailTokens.userId, other.id)).all(),
    ).toEqual([]);
  });
});

describe('POST /api/v1/auth/verify-email/confirm', () => {
  it('confirms under the product policy without paying anything: the credits are for Google sign-in', async () => {
    stubEnv({ SIGNUP_BONUS_PROVIDER: 'google' });
    const { user } = unconfirmed();
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    const result = await confirm({ token: secret });
    expect(result.status).toBe(200);
    expect(result.json.data).toEqual({ verified: true, alreadyVerified: false, bonusCredits: 0 });
    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row?.emailVerifiedAt).toBeGreaterThan(0);
    expect(row?.creditBalance).toBe(0);
  });

  it('confirms with the link alone: no cookie, no origin, any device', async () => {
    const { user } = unconfirmed();
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    const result = await confirm({ token: secret });
    expect(result.status).toBe(200);
    expect(result.json.data).toEqual({ verified: true, alreadyVerified: false, bonusCredits: 50 });
    expect(result.headers.get('set-cookie')).toBeNull();
    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row?.emailVerifiedAt).toBeGreaterThan(0);
    expect(row?.creditBalance).toBe(50);
    expect(
      harness.db.select().from(creditLedger).where(eq(creditLedger.userId, user.id)).all(),
    ).toHaveLength(1);
  });

  it('uses the link once: the replay is a 400 "used" and pays nothing more', async () => {
    const { user } = unconfirmed();
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    await confirm({ token: secret });
    const replay = await confirm({ token: secret });
    expect(replay.status).toBe(400);
    expect(replay.json.error).toMatchObject({ code: 'bad_request', details: { reason: 'used' } });
    expect(harness.db.select().from(users).where(eq(users.id, user.id)).get()?.creditBalance).toBe(
      50,
    );
  });

  it('says why a link does not work: invalid, expired', async () => {
    const { user } = unconfirmed();
    const expired = issueEmailToken(harness.db, user.id, 'verify', Date.now() - 25 * 3600 * 1000);
    const cases: Array<[string, string]> = [
      [expired.secret, 'expired'],
      ['x'.repeat(43), 'invalid'],
      ['', 'invalid'],
      ['../../etc/passwd', 'invalid'],
    ];
    for (const [token, reason] of cases) {
      const result = await confirm({ token });
      expect(result.status, token).toBe(400);
      expect(result.json.error.details, token).toEqual({ reason });
    }
    expect(
      harness.db.select().from(users).where(eq(users.id, user.id)).get()?.emailVerifiedAt,
    ).toBeNull();
  });

  it('ignores a token in the query string: only the JSON body counts', async () => {
    const { user } = unconfirmed();
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    const result = await invokeRoute<Body>(confirmModule.POST, {
      url: `${CONFIRM_URL}?token=${secret}`,
      method: 'POST',
      body: {},
    });
    expect(result.status).toBe(422);
    expect(
      harness.db.select().from(users).where(eq(users.id, user.id)).get()?.emailVerifiedAt,
    ).toBeNull();
  });

  it('cannot be triggered by opening a URL: there is no GET', () => {
    expect(Object.keys(confirmModule)).not.toContain('GET');
    expect(Object.keys(requestModule)).not.toContain('GET');
  });

  it.each([
    ['no body', undefined, 422],
    ['a number', { token: 42 }, 422],
    ['a token far longer than any real one', { token: 'a'.repeat(300) }, 422],
    ['an array', [], 422],
    ['a body past the 8 KiB cap', { token: 'a'.repeat(10_000) }, 413],
  ])('rejects %s', async (_label, body, status) => {
    const result = await confirm(body);
    expect(result.status).toBe(status);
    expect(result.json.error.code).toBe(status === 413 ? 'payload_too_large' : 'validation_failed');
  });

  it('wants JSON', async () => {
    const result = await confirm('token=abc', { 'content-type': 'text/plain' });
    expect(result.status).toBe(415);
  });

  it('is bounded per client address: 30 an hour behind a proxy', async () => {
    stubEnv({ TRUST_PROXY: 'true' });
    const from = (address: string) => ({ 'x-forwarded-for': address });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await confirm({ token: 'nope' }, from('198.51.100.1'))).status).toBe(400);
    }
    const blocked = await confirm({ token: 'nope' }, from('198.51.100.1'));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    // Somebody else is not affected.
    expect((await confirm({ token: 'nope' }, from('198.51.100.2'))).status).toBe(400);
  });

  it('has no shared budget when clients cannot be told apart: junk from anyone never locks out a real link', async () => {
    // The address is unknown (no trusted proxy), so every visitor looks alike.
    const { user } = unconfirmed();
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    for (let attempt = 0; attempt < 1300; attempt += 1) {
      const junk = await confirm({ token: 'nope' });
      expect(junk.status).toBe(400);
      expect(junk.headers.get('x-ratelimit-limit')).toBeNull();
    }
    const result = await confirm({ token: secret }, browser());
    expect(result.status).toBe(200);
    expect(result.json.data).toMatchObject({ verified: true });
  });

  it('works with the browser headers the page sends', async () => {
    const { user } = unconfirmed();
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    const result = await confirm({ token: secret }, browser());
    expect(result.status).toBe(200);
  });
});
