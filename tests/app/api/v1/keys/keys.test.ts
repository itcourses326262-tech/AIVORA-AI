import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as listKeys, POST as createKey } from '@/app/api/v1/keys/route';
import { DELETE as deleteKey } from '@/app/api/v1/keys/[id]/route';
import { GET as account } from '@/app/api/v1/account/route';
import { apiKeys } from '@/server/db/schema';
import { MAX_ACTIVE_API_KEYS, createApiKey } from '@/server/auth/api-keys';
import type { ApiKeyDTO, CreateApiKeyResponse, Page } from '@/lib/api-types';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { browser, stubEnv, routeTestState, type ErrorBody } from '../auth/support';

const harness = freshDb();
routeTestState();

function list(headers: Record<string, string>) {
  return invokeRoute<Page<ApiKeyDTO> & ErrorBody>(listKeys, { url: '/api/v1/keys', headers });
}

function create(body: unknown, headers: Record<string, string>) {
  return invokeRoute<{ data: CreateApiKeyResponse } & ErrorBody>(createKey, {
    url: '/api/v1/keys',
    method: 'POST',
    body,
    headers,
  });
}

function revoke(id: string, headers: Record<string, string>) {
  return invokeRoute<ErrorBody, { id: string }>(deleteKey, {
    url: `/api/v1/keys/${id}`,
    method: 'DELETE',
    params: { id },
    headers,
  });
}

function whoamiWithKey(key: string) {
  return invokeRoute<{ data: { id: string } } & ErrorBody>(account, {
    url: '/api/v1/account',
    headers: { authorization: `Bearer ${key}` },
  });
}

describe('POST /api/v1/keys', () => {
  it('creates a key, shows the secret exactly once and the key then works', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);

    const result = await create({ name: 'CI pipeline' }, session.headers);
    expect(result.status).toBe(201);
    const { key, record } = result.json.data;
    expect(key).toMatch(/^avk_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(record).toMatchObject({ name: 'CI pipeline', prefix: key.slice(0, 12) });
    expect(Object.keys(record).sort()).toEqual(['createdAt', 'id', 'name', 'prefix']);

    // Never again: neither the list nor the database contains the secret part.
    const listed = await list(session.headers);
    expect(listed.text).not.toContain(key.slice(13));
    expect(JSON.stringify(harness.db.select().from(apiKeys).all())).not.toContain(key.slice(13));

    const used = await whoamiWithKey(key);
    expect(used.status).toBe(200);
    expect(used.json.data.id).toBe(user.id);
  });

  it('validates the name', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    for (const body of [
      undefined,
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(61) },
      { name: 7 },
      { name: 'a\u0000b' },
    ]) {
      const result = await create(body, session.headers);
      expect(result.status, JSON.stringify(body)).toBe(422);
    }
    expect(harness.db.select().from(apiKeys).all()).toHaveLength(0);
  });

  it(`allows ${MAX_ACTIVE_API_KEYS} active keys and answers 409 for the next one`, async () => {
    stubEnv({ RATE_LIMIT_DISABLED: 'true' });
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    for (let index = 0; index < MAX_ACTIVE_API_KEYS; index += 1) {
      expect((await create({ name: `key ${index}` }, session.headers)).status).toBe(201);
    }
    const over = await create({ name: 'one too many' }, session.headers);
    expect(over.status).toBe(409);
    expect(over.json.error.code).toBe('conflict');
    expect(over.json.error.message).toMatch(/20/);
  });

  it('is limited to 10 creations a minute per user', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    // Revoke as we go so the 20 key cap is not what stops us.
    for (let index = 0; index < 10; index += 1) {
      const result = await create({ name: `k${index}` }, session.headers);
      expect(result.status).toBe(201);
      harness.db
        .update(apiKeys)
        .set({ revokedAt: Date.now() })
        .where(eq(apiKeys.id, result.json.data.record.id))
        .run();
    }
    const blocked = await create({ name: 'eleventh' }, session.headers);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/keys', () => {
  it('lists the caller keys, newest first, as a page, with revoked ones marked', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    const first = await createApiKey(user.id, 'first');
    await new Promise((resolve) => setTimeout(resolve, 3));
    await createApiKey(user.id, 'second');
    await revoke(first.record.id, session.headers);

    const result = await list(session.headers);
    expect(result.status).toBe(200);
    expect(result.json.nextCursor).toBeNull();
    expect(result.json.data.map((key) => key.name)).toEqual(['second', 'first']);
    expect(result.json.data[1]?.revokedAt).toBeTypeOf('number');
    expect(result.json.data[0]).not.toHaveProperty('revokedAt');
  });

  it("never shows another user's keys", async () => {
    const owner = createUser(harness.db);
    const stranger = createUser(harness.db);
    await createApiKey(owner.id, 'private');
    const result = await list(createSession(harness.db, stranger.id).headers);
    expect(result.json.data).toEqual([]);
  });
});

describe('DELETE /api/v1/keys/:id', () => {
  it('revokes the key: 204, and it stops authenticating at once', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    const { key, record } = await createApiKey(user.id, 'doomed');
    expect((await whoamiWithKey(key)).status).toBe(200);

    const result = await revoke(record.id, session.headers);
    expect(result.status).toBe(204);
    expect((await whoamiWithKey(key)).status).toBe(401);
    expect((await list(session.headers)).json.data[0]?.revokedAt).toBeTypeOf('number');
    // Revoking again is fine.
    expect((await revoke(record.id, session.headers)).status).toBe(204);
  });

  it("is 404 for another user's key and the key keeps working (no IDOR)", async () => {
    const owner = createUser(harness.db);
    const attacker = createUser(harness.db);
    const { key, record } = await createApiKey(owner.id, 'private');
    const attackerSession = createSession(harness.db, attacker.id);

    const foreign = await revoke(record.id, attackerSession.headers);
    expect(foreign.status).toBe(404);
    expect(foreign.json.error.code).toBe('not_found');
    expect((await whoamiWithKey(key)).status).toBe(200);

    // Indistinguishable from a key that does not exist, or an id that is not even an id.
    const missing = await revoke('key_00000000000000000000000000', attackerSession.headers);
    const garbage = await revoke('not-an-id', attackerSession.headers);
    expect(missing.status).toBe(404);
    expect(garbage.status).toBe(404);
    expect(missing.json).toEqual(foreign.json);
  });

  it('refuses a cross-site request', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    const { key, record } = await createApiKey(user.id, 'safe');
    const result = await revoke(record.id, {
      cookie: session.cookie,
      origin: 'https://evil.example',
    });
    expect(result.status).toBe(403);
    expect((await whoamiWithKey(key)).status).toBe(200);
  });
});

describe('key management is session-only', () => {
  it('an API key can neither list, create nor revoke keys (a leaked key cannot spawn or kill keys)', async () => {
    const user = createUser(harness.db);
    const { key, record } = await createApiKey(user.id, 'ci');
    const headers = { authorization: `Bearer ${key}` };

    for (const result of [
      await list(headers),
      await create({ name: 'spawn' }, headers),
      await revoke(record.id, headers),
    ]) {
      expect(result.status).toBe(403);
      expect(result.json.error.code).toBe('forbidden');
    }
    expect(harness.db.select().from(apiKeys).all()).toHaveLength(1);
    expect((await whoamiWithKey(key)).status).toBe(200);
  });

  it('anonymous callers get 401 on all three', async () => {
    for (const result of [
      await list(browser()),
      await create({ name: 'x' }, browser()),
      await revoke('key_00000000000000000000000000', browser()),
    ]) {
      expect(result.status).toBe(401);
    }
  });
});
