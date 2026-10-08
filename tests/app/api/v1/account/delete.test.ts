import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LoggerModule from '@/server/logger';
import { DELETE as deleteRoute } from '@/app/api/v1/account/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { onAccountDeleted } from '@/server/auth/account-hooks';
import { createApiKey, resolveApiKey } from '@/server/auth/api-keys';
import { apiKeys, assets, generations, sessions, users } from '@/server/db/schema';
import { getOutbox } from '@/server/email';
import { setStorageOverride } from '@/server/storage';
import { freshDb } from '../../../../helpers/db';
import {
  createAsset,
  createGeneration,
  createSession,
  createUser,
  fakeStorage,
} from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { cleanEmailState, mailTo } from '../../../../server/email/support';
import { GOOD_PASSWORD, passwordFixture } from '../../../../server/auth/trust-support';
import { browser, cookieNamed, routeTestState, setCookies, type ErrorBody } from '../auth/support';

// The 502 test below logs the failure it provokes on purpose; keep the test output quiet.
vi.mock('@/server/logger', async (importOriginal) => {
  const original = await importOriginal<typeof LoggerModule>();
  const quiet = { debug() {}, info() {}, warn() {}, error() {}, level: 'silent' as const };
  return { ...original, getLogger: () => ({ ...quiet, child: () => quiet }) };
});

const harness = freshDb();
const fixture = passwordFixture();
routeTestState();
cleanEmailState();

const URL_ = '/api/v1/account';
let storage: ReturnType<typeof fakeStorage>;
const off: Array<() => void> = [];

beforeEach(() => {
  storage = fakeStorage();
  setStorageOverride(storage);
});
afterEach(() => {
  setStorageOverride(null);
  while (off.length) off.pop()?.();
});

function remove(body: unknown, headers: Record<string, string>, query?: Record<string, string>) {
  return invokeRoute<{ data?: unknown } & ErrorBody>(deleteRoute, {
    url: URL_,
    method: 'DELETE',
    body,
    headers,
    query,
  });
}

async function person(email = 'layla@example.com') {
  const user = createUser(harness.db, {
    email,
    name: 'Layla',
    locale: 'en',
    passwordHash: fixture.hash,
  });
  const session = createSession(harness.db, user.id);
  const { key } = await createApiKey(user.id, 'ci');
  const generation = createGeneration(harness.db, { userId: user.id, status: 'succeeded' });
  const output = createAsset(harness.db, {
    userId: user.id,
    role: 'output',
    generationId: generation.id,
  });
  await storage.put(output.storageKey, new Uint8Array([1]), { mimeType: 'image/png' });
  return { user, session, key, generation, output };
}

const row = (id: string) => harness.db.select().from(users).where(eq(users.id, id)).get();

describe('DELETE /api/v1/account', () => {
  it('needs a login, and a browser session at that', async () => {
    expect((await remove({ password: GOOD_PASSWORD }, browser())).status).toBe(401);
    const a = await person();
    const viaKey = await remove({ password: GOOD_PASSWORD }, { authorization: `Bearer ${a.key}` });
    expect(viaKey.status).toBe(403);
    expect(row(a.user.id)?.deletedAt).toBeNull();
  });

  it('deletes the account for the right password: 204, session cookie cleared, everything gone', async () => {
    const a = await person();
    const result = await remove({ password: GOOD_PASSWORD }, a.session.headers);

    expect(result.status).toBe(204);
    const cleared = cookieNamed(result, 'aivore_session');
    expect(cleared.value).toBe('');
    expect(cleared.attributes.get('max-age')).toBe('0');
    expect(setCookies(result).map((cookie) => cookie.name)).toEqual(['aivore_session']);

    expect(row(a.user.id)).toMatchObject({ name: '', email: `${a.user.id}@deleted.invalid` });
    expect(row(a.user.id)?.deletedAt).not.toBeNull();
    expect(harness.db.select().from(sessions).where(eq(sessions.userId, a.user.id)).all()).toEqual(
      [],
    );
    expect(resolveApiKey(a.key, harness.db)).toBeNull();
    expect(
      harness.db.select().from(generations).where(eq(generations.userId, a.user.id)).all(),
    ).toEqual([]);
    expect(harness.db.select().from(assets).where(eq(assets.userId, a.user.id)).all()).toEqual([]);
    expect(await storage.head(a.output.storageKey)).toBeNull();

    // The cookie in the browser is dead, whatever it still holds.
    const whoami = await invokeRoute<{ data: unknown }>(me, {
      url: '/api/v1/auth/me',
      headers: { cookie: a.session.cookie },
    });
    expect(whoami.json.data).toBeNull();
    const mail = await mailTo('layla@example.com');
    expect(mail?.kind).toBe('account_deleted');
  });

  it('is repeatable without harm: the stale cookie is simply no longer a login', async () => {
    const a = await person();
    await remove({ password: GOOD_PASSWORD }, a.session.headers);
    expect((await remove({ password: GOOD_PASSWORD }, a.session.headers)).status).toBe(401);
    await mailTo('layla@example.com');
    expect(getOutbox()).toHaveLength(1);
  });

  describe('the password check', () => {
    it.each([
      ['a wrong password', { password: 'not my password at all' }],
      ['an empty password', { password: '' }],
      ['no password', {}],
      ['no body', undefined],
      ['a password of the wrong type', { password: 12345678 }],
    ])('refuses %s and deletes nothing', async (_label, body) => {
      const a = await person();
      const result = await remove(body, a.session.headers);
      expect(result.status).toBe(422);
      expect(result.json.error.code).toBe('validation_failed');
      expect(row(a.user.id)?.deletedAt).toBeNull();
      expect(
        harness.db.select().from(sessions).where(eq(sessions.userId, a.user.id)).all(),
      ).toHaveLength(1);
      expect(await storage.head(a.output.storageKey)).not.toBeNull();
      await mailTo('layla@example.com');
      expect(getOutbox()).toEqual([]);
    });

    it('points at the password field', async () => {
      const a = await person();
      const result = await remove({ password: 'not my password at all' }, a.session.headers);
      expect(result.json.error.details).toMatchObject({ issues: [{ path: 'password' }] });
    });

    it('is limited to 5 attempts an hour per account, even for the right password afterwards', async () => {
      const a = await person();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await remove({ password: 'wrong wrong wrong' }, a.session.headers)).status).toBe(
          422,
        );
      }
      const blocked = await remove({ password: GOOD_PASSWORD }, a.session.headers);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).not.toBeNull();
      expect(row(a.user.id)?.deletedAt).toBeNull();
    });
  });

  it('is protected against cross-site requests', async () => {
    const a = await person();
    const attempts: Array<Record<string, string>> = [
      { cookie: a.session.cookie, origin: 'https://evil.example' },
      { cookie: a.session.cookie },
      { cookie: a.session.cookie, origin: 'null' },
    ];
    for (const headers of attempts) {
      const result = await remove({ password: GOOD_PASSWORD }, headers);
      expect(result.status, JSON.stringify(headers)).toBe(403);
    }
    expect(row(a.user.id)?.deletedAt).toBeNull();
  });

  it('only ever deletes the caller: ids in the body, query or headers are ignored', async () => {
    const a = await person('layla@example.com');
    const b = await person('omar@example.com');
    const result = await remove(
      { password: GOOD_PASSWORD, userId: a.user.id, id: a.user.id, email: 'layla@example.com' },
      { ...b.session.headers, 'x-user-id': a.user.id },
      { userId: a.user.id },
    );
    expect(result.status).toBe(204);
    expect(row(b.user.id)?.deletedAt).not.toBeNull();
    expect(row(a.user.id)).toMatchObject({ email: 'layla@example.com', deletedAt: null });
    expect(await storage.head(a.output.storageKey)).not.toBeNull();
    expect(
      harness.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, a.user.id))
        .all()
        .every((k) => k.revokedAt === null),
    ).toBe(true);
  });

  it('leaves the account whole, with a 502, when a connected service (billing) cannot let go', async () => {
    const a = await person();
    off.push(
      onAccountDeleted('billing', () => {
        throw new Error('moyasar is down');
      }),
    );
    const result = await remove({ password: GOOD_PASSWORD }, a.session.headers);
    expect(result.status).toBe(502);
    expect(result.json.error.code).toBe('provider_error');
    // The message names no internals.
    expect(JSON.stringify(result.json)).not.toContain('moyasar');
    expect(row(a.user.id)).toMatchObject({ email: 'layla@example.com', deletedAt: null });
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  it('will not let the only administrator remove themselves', async () => {
    const admin = createUser(harness.db, { role: 'admin', passwordHash: fixture.hash });
    const session = createSession(harness.db, admin.id);
    const result = await remove({ password: GOOD_PASSWORD }, session.headers);
    expect(result.status).toBe(409);
    expect(result.json.error.code).toBe('conflict');
    expect(row(admin.id)?.deletedAt).toBeNull();
  });

  it('wants JSON and a small body', async () => {
    const a = await person();
    const text = await remove('password=abc', {
      ...a.session.headers,
      'content-type': 'text/plain',
    });
    expect(text.status).toBe(415);
    const big = await remove({ password: 'a'.repeat(9000) }, a.session.headers);
    expect(big.status).toBe(413);
  });
});
