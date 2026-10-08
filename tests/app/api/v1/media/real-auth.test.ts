import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiKey, revokeApiKey } from '@/server/auth/api-keys';
import { users } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { InMemoryRateLimiter, setRateLimiter } from '@/server/security/rate-limit';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUserWithSession } from '../../../../helpers/factories';
import { TINY_PNG } from '../../../../helpers/fakes';
import { setGenerationPublic, storeAsset, withTempStorage } from './support';

// Deliberately NOT mocking '@/server/auth': these tests run the media route through the real
// `authenticate`, so a change to its semantics (which credential wins, revoked keys, expired
// sessions, disabled users) fails here, next to the access rules that depend on it.
import { GET, HEAD } from '@/app/api/v1/media/[assetId]/route';

const state = freshDb();
const disk = withTempStorage();

beforeEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  setRateLimiter(new InMemoryRateLimiter());
});

async function call(handler: typeof GET, assetId: string, headers: Record<string, string> = {}) {
  const method = handler === HEAD ? 'HEAD' : 'GET';
  const response = await handler(
    new Request(`http://localhost:3000/api/v1/media/${assetId}`, { method, headers }),
    { params: Promise.resolve({ assetId }) },
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, bytes };
}
const get = (assetId: string, headers?: Record<string, string>) => call(GET, assetId, headers);

const NOT_FOUND = { error: { code: 'not_found', message: 'Asset not found' } };
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
/** Looks like a key (`avk_<8>_<43>`) but was never issued. */
const UNISSUED_KEY = `avk_abcd1234_${'A'.repeat(43)}`;

async function scene(options: { isPublic?: boolean } = {}) {
  const owner = createUserWithSession(state.db);
  const other = createUserWithSession(state.db);
  const asset = await storeAsset(disk.storage, {
    userId: owner.user.id,
    bytes: TINY_PNG,
    ...(options.isPublic === undefined ? {} : { generation: { isPublic: options.isPublic } }),
  });
  return {
    owner,
    other,
    asset,
    ownerKey: await createApiKey(owner.user.id, 'owner key'),
    otherKey: await createApiKey(other.user.id, 'other key'),
  };
}

async function expectHidden(assetId: string, headers: Record<string, string>) {
  for (const handler of [GET, HEAD]) {
    const result = await call(handler, assetId, headers);
    expect(result.status).toBe(404);
    expect(result.headers.get('cache-control')).toBe('no-store');
    if (handler === GET)
      expect(JSON.parse(new TextDecoder().decode(result.bytes))).toEqual(NOT_FOUND);
  }
}

describe('a private asset, with the real authenticate', () => {
  it('is served to its owner by session cookie and by API key', async () => {
    const { owner, ownerKey, asset } = await scene();
    for (const headers of [owner.session.headers, bearer(ownerKey.key)]) {
      for (const handler of [GET, HEAD]) {
        const result = await call(handler, asset.id, headers);
        expect(result.status).toBe(200);
        expect(result.headers.get('cache-control')).toBe('private, max-age=3600');
        if (handler === GET) expect(result.bytes).toEqual(TINY_PNG);
      }
    }
  });

  it('is a 404 for another user, by cookie and by key, and for an anonymous caller', async () => {
    const { other, otherKey, asset } = await scene();
    await expectHidden(asset.id, other.session.headers);
    await expectHidden(asset.id, bearer(otherKey.key));
    await expectHidden(asset.id, {});
  });

  it('treats a presented API key as authoritative: a wrong key is anonymous even with the owner cookie', async () => {
    const { owner, asset } = await scene();
    await expectHidden(asset.id, { ...owner.session.headers, ...bearer(UNISSUED_KEY) });
    await expectHidden(asset.id, { ...owner.session.headers, ...bearer('avk_nope') });
  });

  it('lets the key win over a cookie in both directions', async () => {
    const { owner, other, ownerKey, otherKey, asset } = await scene();
    await expectHidden(asset.id, { ...owner.session.headers, ...bearer(otherKey.key) });
    const viaKey = await get(asset.id, { ...other.session.headers, ...bearer(ownerKey.key) });
    expect(viaKey.status).toBe(200);
  });

  it('stops serving a revoked key at once, even next to the owner session', async () => {
    const { owner, ownerKey, asset } = await scene();
    expect((await get(asset.id, bearer(ownerKey.key))).status).toBe(200);
    await revokeApiKey(owner.user.id, ownerKey.record.id);
    await expectHidden(asset.id, bearer(ownerKey.key));
    await expectHidden(asset.id, { ...owner.session.headers, ...bearer(ownerKey.key) });
    expect((await get(asset.id, owner.session.headers)).status).toBe(200);
  });

  it('is a 404 once the session has expired', async () => {
    const { owner, asset } = await scene();
    const expired = createSession(state.db, owner.user.id, { expiresAt: Date.now() - 1000 });
    await expectHidden(asset.id, expired.headers);
  });

  it('is a 404 for a disabled account, by cookie and by key', async () => {
    const { owner, ownerKey, asset } = await scene();
    state.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, owner.user.id)).run();
    await expectHidden(asset.id, owner.session.headers);
    await expectHidden(asset.id, bearer(ownerKey.key));
  });
});

describe('a public output, with the real authenticate', () => {
  it('stays readable when credentials are bad, but is then shared, not private', async () => {
    const { owner, ownerKey, asset } = await scene({ isPublic: true });
    await revokeApiKey(owner.user.id, ownerKey.record.id);
    for (const headers of [{}, bearer(ownerKey.key), bearer(UNISSUED_KEY)]) {
      const result = await get(asset.id, headers);
      expect(result.status).toBe(200);
      expect(result.headers.get('cache-control')).toBe('public, max-age=300');
    }
    const asOwner = await get(asset.id, owner.session.headers);
    expect(asOwner.headers.get('cache-control')).toBe('private, max-age=3600');
  });

  it('becomes hidden again when the owner makes the generation private', async () => {
    const { asset } = await scene({ isPublic: true });
    expect((await get(asset.id)).status).toBe(200);
    setGenerationPublic(asset.generationId ?? '', false);
    await expectHidden(asset.id, {});
  });
});
