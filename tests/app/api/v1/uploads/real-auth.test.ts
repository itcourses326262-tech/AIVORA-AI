import { readdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetDTO } from '@/lib/api-types';
import { createApiKey, revokeApiKey } from '@/server/auth/api-keys';
import { getDb } from '@/server/db';
import { assets, users } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { InMemoryRateLimiter, setRateLimiter } from '@/server/security/rate-limit';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUserWithSession } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { makePng, toFile } from '../../../../server/uploads/support';
import { withTempStorage } from '../media/support';

// Deliberately NOT mocking '@/server/auth' or '@/server/security/origin': the upload route runs
// through the real `authenticate` and the real same-origin (CSRF) check.
import { POST } from '@/app/api/v1/uploads/route';

const state = freshDb();
const disk = withTempStorage();

beforeEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  setRateLimiter(new InMemoryRateLimiter());
});

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
/** Looks like a key (`avk_<8>_<43>`) but was never issued. */
const UNISSUED_KEY = `avk_abcd1234_${'A'.repeat(43)}`;

async function upload(headers: Record<string, string>) {
  const body = new FormData();
  body.append('file', toFile(await makePng(30, 20)));
  return invokeRoute<{ data?: AssetDTO; error?: { code: string } }>(POST, {
    url: '/api/v1/uploads',
    body,
    headers,
  });
}

const storedObjects = () =>
  readdirSync(disk.directory, { recursive: true, withFileTypes: true }).filter(
    (entry) => entry.isFile() && !entry.name.startsWith('.'),
  );
const assetRows = () => getDb().select().from(assets).all();

async function expectRefused(headers: Record<string, string>, status: number, code: string) {
  const result = await upload(headers);
  expect(result.status).toBe(status);
  expect(result.json.error?.code).toBe(code);
  expect(assetRows()).toEqual([]);
  expect(storedObjects()).toEqual([]);
}

describe('POST /api/v1/uploads with the real authenticate', () => {
  it('stores the file for the session user when the Origin is the site', async () => {
    const { user, session } = createUserWithSession(state.db);
    const result = await upload(session.headers);
    expect(result.status).toBe(201);
    expect(assetRows()).toMatchObject([{ id: result.json.data?.id, userId: user.id }]);
  });

  it('stores the file for the API key user, without any Origin', async () => {
    const { user } = createUserWithSession(state.db);
    const { key } = await createApiKey(user.id, 'ci');
    const result = await upload(bearer(key));
    expect(result.status).toBe(201);
    expect(assetRows()).toMatchObject([{ id: result.json.data?.id, userId: user.id }]);
  });

  it('is 401 without credentials and for a key nobody was issued', async () => {
    await expectRefused({}, 401, 'unauthorized');
    await expectRefused(bearer(UNISSUED_KEY), 401, 'unauthorized');
    await expectRefused(bearer('avk_nope'), 401, 'unauthorized');
  });

  it('does not fall back to the cookie when a wrong key is presented', async () => {
    const { session } = createUserWithSession(state.db);
    await expectRefused({ ...session.headers, ...bearer(UNISSUED_KEY) }, 401, 'unauthorized');
  });

  it('attributes the upload to the key, not to a cookie sent beside it', async () => {
    const keyOwner = createUserWithSession(state.db);
    const cookieOwner = createUserWithSession(state.db);
    const { key } = await createApiKey(keyOwner.user.id, 'ci');
    const result = await upload({ ...cookieOwner.session.headers, ...bearer(key) });
    expect(result.status).toBe(201);
    expect(assetRows()).toMatchObject([{ userId: keyOwner.user.id }]);
  });

  it('is 401 for a revoked key, with or without the owner cookie beside it', async () => {
    const { user, session } = createUserWithSession(state.db);
    const { key, record } = await createApiKey(user.id, 'ci');
    await revokeApiKey(user.id, record.id);
    await expectRefused(bearer(key), 401, 'unauthorized');
    await expectRefused({ ...session.headers, ...bearer(key) }, 401, 'unauthorized');
  });

  it('is 401 for an expired session and for a disabled account', async () => {
    const { user, session } = createUserWithSession(state.db);
    const expired = createSession(state.db, user.id, { expiresAt: Date.now() - 1000 });
    await expectRefused(expired.headers, 401, 'unauthorized');

    const { key } = await createApiKey(user.id, 'ci');
    state.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    await expectRefused(session.headers, 401, 'unauthorized');
    await expectRefused(bearer(key), 401, 'unauthorized');
  });

  it('refuses a cookie-authenticated upload from another site or without an Origin (CSRF)', async () => {
    const { session } = createUserWithSession(state.db);
    await expectRefused({ cookie: session.cookie }, 403, 'forbidden');
    await expectRefused(
      { cookie: session.cookie, origin: 'https://evil.example' },
      403,
      'forbidden',
    );
    await expectRefused({ cookie: session.cookie, origin: 'null' }, 403, 'forbidden');
  });
});
