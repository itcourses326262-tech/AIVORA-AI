import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET, PATCH } from '@/app/api/v1/account/route';
import { users } from '@/server/db/schema';
import { createApiKey } from '@/server/auth/api-keys';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import {
  browser,
  cookieNamed,
  expectUserDTO,
  setCookies,
  stubEnv,
  routeTestState,
  type ErrorBody,
} from '../auth/support';

const harness = freshDb();
routeTestState();

const URL_ = '/api/v1/account';

function read(headers: Record<string, string>) {
  return invokeRoute<{ data: unknown } & ErrorBody>(GET, { url: URL_, headers });
}

function patch(body: unknown, headers: Record<string, string>) {
  return invokeRoute<{ data: unknown } & ErrorBody>(PATCH, {
    url: URL_,
    method: 'PATCH',
    body,
    headers,
  });
}

describe('GET /api/v1/account', () => {
  it('returns the UserDTO for a session and for an API key', async () => {
    const user = createUser(harness.db, { name: 'Dina', creditBalance: 8 });
    const session = createSession(harness.db, user.id);
    const { key } = await createApiKey(user.id, 'ci');

    for (const headers of [{ cookie: session.cookie }, { authorization: `Bearer ${key}` }] as Array<
      Record<string, string>
    >) {
      const result = await read(headers);
      expect(result.status).toBe(200);
      expectUserDTO(result.json.data);
      expect(result.json.data).toMatchObject({ id: user.id, name: 'Dina', creditBalance: 8 });
    }
  });

  it('is 401 without credentials, with a bad cookie and with a revoked key', async () => {
    for (const headers of [
      {},
      { cookie: 'aivore_session=garbage' },
      { authorization: 'Bearer avk_aaaaaaaa_' + 'a'.repeat(43) },
    ] as Array<Record<string, string>>) {
      const result = await read(headers);
      expect(result.status).toBe(401);
      expect(result.json.error.code).toBe('unauthorized');
    }
  });
});

describe('PATCH /api/v1/account', () => {
  it('updates the name', async () => {
    const user = createUser(harness.db, { name: 'Old' });
    const session = createSession(harness.db, user.id);
    const result = await patch({ name: '  New   Name ' }, session.headers);
    expect(result.status).toBe(200);
    expectUserDTO(result.json.data);
    expect(result.json.data).toMatchObject({ name: 'New Name', locale: user.locale });
    expect(harness.db.select().from(users).where(eq(users.id, user.id)).get()?.name).toBe(
      'New Name',
    );
    expect(setCookies(result)).toEqual([]); // no language change: no locale cookie
  });

  it('updates the language and the locale cookie follows', async () => {
    const user = createUser(harness.db, { locale: 'ar' });
    const session = createSession(harness.db, user.id);
    const result = await patch({ locale: 'en' }, session.headers);
    expect(result.json.data).toMatchObject({ locale: 'en' });
    expect(cookieNamed(result, 'aivore_locale').value).toBe('en');
    expect(harness.db.select().from(users).where(eq(users.id, user.id)).get()?.locale).toBe('en');
  });

  it('rejects empty and invalid updates with 422 and changes nothing', async () => {
    const user = createUser(harness.db, { name: 'Keep' });
    const session = createSession(harness.db, user.id);
    for (const body of [
      {},
      undefined,
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(500) },
      { name: 'a‮b' },
      { locale: 'fr' },
      { name: 5 },
    ]) {
      const result = await patch(body, session.headers);
      expect(result.status, JSON.stringify(body)).toBe(422);
      expect(result.json.error.code).toBe('validation_failed');
    }
    expect(harness.db.select().from(users).where(eq(users.id, user.id)).get()?.name).toBe('Keep');
  });

  it('cannot change anything but name and locale (no mass assignment)', async () => {
    const user = createUser(harness.db, {
      role: 'user',
      creditBalance: 1,
      email: 'safe@example.com',
    });
    const session = createSession(harness.db, user.id);
    const result = await patch(
      {
        name: 'Same',
        role: 'admin',
        creditBalance: 1_000_000,
        email: 'evil@example.com',
        id: 'usr_other',
        passwordHash: 'x',
        disabledAt: 1,
      },
      session.headers,
    );
    expect(result.status).toBe(200);
    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row).toMatchObject({
      role: 'user',
      creditBalance: 1,
      email: 'safe@example.com',
      id: user.id,
      disabledAt: null,
    });
    expect(row?.passwordHash).toBe(user.passwordHash);
  });

  it('works with an API key and needs no Origin there', async () => {
    const user = createUser(harness.db);
    const { key } = await createApiKey(user.id, 'ci');
    const result = await patch({ name: 'Via key' }, { authorization: `Bearer ${key}` });
    expect(result.status).toBe(200);
    expect(result.json.data).toMatchObject({ name: 'Via key' });
  });

  it('only changes the caller: user A cannot patch user B', async () => {
    const a = createUser(harness.db, { name: 'A' });
    const b = createUser(harness.db, { name: 'B' });
    const session = createSession(harness.db, a.id);
    await patch({ name: 'Renamed' }, session.headers);
    expect(harness.db.select().from(users).where(eq(users.id, b.id)).get()?.name).toBe('B');
  });

  it('is 401 without credentials', async () => {
    expect((await patch({ name: 'X' }, browser())).status).toBe(401);
  });

  describe('CSRF', () => {
    it('refuses a cookie-authenticated PATCH without a matching Origin', async () => {
      const user = createUser(harness.db, { name: 'Safe' });
      const session = createSession(harness.db, user.id);
      for (const headers of [
        { cookie: session.cookie },
        { cookie: session.cookie, origin: 'https://evil.example' },
        { cookie: session.cookie, origin: 'null' },
        { cookie: session.cookie, referer: 'https://evil.example/attack.html' },
        { ...session.headers, 'sec-fetch-site': 'cross-site' },
      ] as Array<Record<string, string>>) {
        const result = await patch({ name: 'Hacked' }, headers);
        expect(result.status, JSON.stringify(headers)).toBe(403);
        expect(result.json.error.code).toBe('forbidden');
      }
      expect(harness.db.select().from(users).where(eq(users.id, user.id)).get()?.name).toBe('Safe');
    });

    it('accepts the same origin through Origin or Referer', async () => {
      const user = createUser(harness.db);
      const session = createSession(harness.db, user.id);
      expect((await patch({ name: 'One' }, session.headers)).status).toBe(200);
      expect(
        (
          await patch(
            { name: 'Two' },
            { cookie: session.cookie, referer: 'http://localhost:3000/account' },
          )
        ).status,
      ).toBe(200);
    });

    it('never checks safe methods: GET works cross-origin (it changes nothing)', async () => {
      const user = createUser(harness.db);
      const session = createSession(harness.db, user.id);
      expect((await read({ cookie: session.cookie, origin: 'https://evil.example' })).status).toBe(
        200,
      );
    });
  });

  it('trusts the configured APP_URL for the origin check', async () => {
    stubEnv({ APP_URL: 'https://aivore.example' });
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    expect(
      (await patch({ name: 'X' }, { cookie: session.cookie, origin: 'https://aivore.example' }))
        .status,
    ).toBe(200);
    expect(
      (await patch({ name: 'Y' }, { cookie: session.cookie, origin: 'http://localhost:3000' }))
        .status,
    ).toBe(403);
  });
});
