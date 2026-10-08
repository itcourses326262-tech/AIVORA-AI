import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { freshDb } from '../../helpers/db';
import { AppError } from '@/lib/errors';
import { apiKeys, users } from '@/server/db/schema';
import {
  API_KEY_TOUCH_INTERVAL_MS,
  MAX_ACTIVE_API_KEYS,
  createApiKey,
  isApiKeyShape,
  listApiKeys,
  resolveApiKey,
  revokeApiKey,
} from '@/server/auth/api-keys';
import { hashToken } from '@/server/auth/tokens';

const harness = freshDb();

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe('createApiKey', () => {
  it('returns avk_<8 char prefix>_<secret> once and stores only a hash', async () => {
    const user = createUser(harness.db);
    const { key, record } = await createApiKey(user.id, 'CI pipeline');

    expect(key).toMatch(/^avk_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(isApiKeyShape(key)).toBe(true);
    expect(record).toMatchObject({ name: 'CI pipeline', prefix: key.slice(0, 12) });
    expect(record).not.toHaveProperty('lastUsedAt');
    expect(record).not.toHaveProperty('revokedAt');
    expect(JSON.stringify(record)).not.toContain(key.slice(13));

    const rows = harness.db.select().from(apiKeys).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyHash).toBe(hashToken(key));
    expect(JSON.stringify(rows)).not.toContain(key.slice(13)); // the secret part is nowhere
    expect(JSON.stringify(await listApiKeys(user.id))).not.toContain(key.slice(13));
  });

  it('makes distinct keys', async () => {
    const user = createUser(harness.db);
    const keys = await Promise.all(
      Array.from({ length: 5 }, () => createApiKey(user.id, 'k').then((r) => r.key)),
    );
    expect(new Set(keys).size).toBe(5);
    expect(new Set(keys.map((key) => key.slice(0, 12))).size).toBe(5);
  });

  it('normalizes the name and rejects empty, hidden-character and overlong names', async () => {
    const user = createUser(harness.db);
    expect((await createApiKey(user.id, '  My   laptop \n')).record.name).toBe('My laptop');
    expect((await createApiKey(user.id, 'مفتاح الاختبار')).record.name).toBe('مفتاح الاختبار');
    for (const bad of [
      '',
      '   ',
      'x'.repeat(61),
      'bell\u0007',
      'rtl‮override',
      42 as unknown as string,
    ]) {
      const error = await failure(createApiKey(user.id, bad));
      expect(error.code, String(bad)).toBe('validation_failed');
      expect(error.details).toEqual({ issues: [{ path: 'name', message: expect.any(String) }] });
    }
  });

  it('allows MAX_ACTIVE_API_KEYS active keys per user and no more', async () => {
    const user = createUser(harness.db);
    const other = createUser(harness.db);
    const created = [];
    for (let index = 0; index < MAX_ACTIVE_API_KEYS; index += 1) {
      created.push(await createApiKey(user.id, `key ${index}`));
    }
    const error = await failure(createApiKey(user.id, 'one too many'));
    expect(error.code).toBe('conflict');
    expect(error.status).toBe(409);
    // The cap is per user.
    await expect(createApiKey(other.id, 'mine').then((r) => r.record.name)).resolves.toBe('mine');

    // Revoked keys do not count: revoking one makes room for exactly one more.
    await revokeApiKey(user.id, created[0]?.record.id ?? '');
    await createApiKey(user.id, 'fits now');
    expect((await failure(createApiKey(user.id, 'full again'))).code).toBe('conflict');
    expect((await listApiKeys(user.id)).filter((key) => !key.revokedAt)).toHaveLength(
      MAX_ACTIVE_API_KEYS,
    );
  });
});

describe('listApiKeys', () => {
  it('lists only the owner keys, newest first, revoked ones included', async () => {
    const user = createUser(harness.db);
    const other = createUser(harness.db);
    const first = await createApiKey(user.id, 'first');
    await new Promise((resolve) => setTimeout(resolve, 3));
    const second = await createApiKey(user.id, 'second');
    await createApiKey(other.id, 'not mine');
    await revokeApiKey(user.id, first.record.id);

    const list = await listApiKeys(user.id);
    expect(list.map((key) => key.name)).toEqual(['second', 'first']);
    expect(list[1]?.revokedAt).toBeTypeOf('number');
    expect(list[0]?.id).toBe(second.record.id);
    expect(await listApiKeys('usr_nobody')).toEqual([]);
  });
});

describe('revokeApiKey', () => {
  it('is 404 for a key that belongs to someone else, the same as for a missing one (no IDOR)', async () => {
    const owner = createUser(harness.db);
    const attacker = createUser(harness.db);
    const { record, key } = await createApiKey(owner.id, 'private');

    const foreign = await failure(revokeApiKey(attacker.id, record.id));
    const missing = await failure(revokeApiKey(attacker.id, 'key_doesnotexist'));
    expect(foreign.code).toBe('not_found');
    expect(foreign.status).toBe(404);
    expect(foreign.message).toBe(missing.message);

    // Untouched: still usable by its owner.
    expect(
      harness.db.select().from(apiKeys).where(eq(apiKeys.id, record.id)).get()?.revokedAt,
    ).toBeNull();
    expect(resolveApiKey(key, harness.db)?.user.id).toBe(owner.id);
  });

  it('revokes, keeps the first revocation time and succeeds when repeated', async () => {
    const user = createUser(harness.db);
    const { record } = await createApiKey(user.id, 'temp');
    await revokeApiKey(user.id, record.id);
    const first = harness.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, record.id))
      .get()?.revokedAt;
    expect(first).toBeTypeOf('number');
    await new Promise((resolve) => setTimeout(resolve, 3));
    await expect(revokeApiKey(user.id, record.id)).resolves.toBeUndefined();
    expect(
      harness.db.select().from(apiKeys).where(eq(apiKeys.id, record.id)).get()?.revokedAt,
    ).toBe(first);
  });
});

describe('resolveApiKey', () => {
  it('authenticates a live key to its owner', async () => {
    const user = createUser(harness.db);
    const { key, record } = await createApiKey(user.id, 'live');
    const resolved = resolveApiKey(key, harness.db);
    expect(resolved).toMatchObject({ keyId: record.id });
    expect(resolved?.user.id).toBe(user.id);
  });

  it('rejects wrong, truncated, extended and look-alike keys', async () => {
    const user = createUser(harness.db);
    const { key } = await createApiKey(user.id, 'live');
    const flipped = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
    for (const bad of [
      flipped,
      key.slice(0, -1),
      `${key}x`,
      key.toUpperCase(),
      key.replace('avk_', 'avk-'),
      '',
      'avk_',
      'Bearer ' + key,
    ]) {
      expect(resolveApiKey(bad, harness.db), bad).toBeNull();
    }
    // Right prefix, wrong secret.
    expect(resolveApiKey(`${key.slice(0, 13)}${'a'.repeat(43)}`, harness.db)).toBeNull();
    // The stored hash is not a credential.
    expect(resolveApiKey(hashToken(key), harness.db)).toBeNull();
  });

  it('rejects revoked keys and keys of disabled users', async () => {
    const user = createUser(harness.db);
    const revoked = await createApiKey(user.id, 'revoked');
    const live = await createApiKey(user.id, 'live');
    await revokeApiKey(user.id, revoked.record.id);
    expect(resolveApiKey(revoked.key, harness.db)).toBeNull();
    expect(resolveApiKey(live.key, harness.db)).not.toBeNull();

    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    expect(resolveApiKey(live.key, harness.db)).toBeNull();
  });

  it('throttles lastUsedAt writes', async () => {
    const user = createUser(harness.db);
    const { key, record } = await createApiKey(user.id, 'busy');
    const read = () =>
      harness.db.select().from(apiKeys).where(eq(apiKeys.id, record.id)).get()?.lastUsedAt;
    expect(read()).toBeNull();

    const t0 = Date.now();
    resolveApiKey(key, harness.db, t0);
    expect(read()).toBe(t0);
    resolveApiKey(key, harness.db, t0 + API_KEY_TOUCH_INTERVAL_MS - 1);
    expect(read()).toBe(t0);
    resolveApiKey(key, harness.db, t0 + API_KEY_TOUCH_INTERVAL_MS);
    expect(read()).toBe(t0 + API_KEY_TOUCH_INTERVAL_MS);
  });

  it('is isolated per user: key hashes never collide across accounts', async () => {
    const a = createUser(harness.db);
    const b = createUser(harness.db);
    const keyA = await createApiKey(a.id, 'a');
    const keyB = await createApiKey(b.id, 'b');
    expect(resolveApiKey(keyA.key, harness.db)?.user.id).toBe(a.id);
    expect(resolveApiKey(keyB.key, harness.db)?.user.id).toBe(b.id);
  });
});
