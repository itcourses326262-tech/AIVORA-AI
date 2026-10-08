import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GenerationDTO } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { getBalance } from '@/server/credits';
import {
  assets,
  creditLedger,
  generations,
  users,
  type NewGenerationRow,
} from '@/server/db/schema';
import {
  cancelGeneration,
  deleteGeneration,
  getGeneration,
  getPublicGeneration,
  listGenerations,
  listPublicGenerations,
  updateGeneration,
} from '@/server/generations/service';
import { claimNextJob } from '@/server/generations/lifecycle';
import { setStorageOverride } from '@/server/storage';
import { expectConsistentLedger } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import { createAsset, createGeneration, createUser, fakeStorage } from '../../helpers/factories';
import { queue } from './support';

const harness = freshDb();
const BASE_TIME = 1_700_000_000_000;

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

/** Generations whose creation order is the order of the returned array. */
function seedMany(userId: string, count: number, overrides: Partial<NewGenerationRow> = {}) {
  return Array.from({ length: count }, (_, index) =>
    createGeneration(harness.db, {
      userId,
      createdAt: BASE_TIME + index,
      prompt: `prompt number ${index}`,
      ...overrides,
    }),
  );
}

async function walk(userId: string, query: Record<string, unknown>, limit: number) {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages += 1) {
    const page = await listGenerations(userId, { ...query, limit, ...(cursor ? { cursor } : {}) });
    expect(page.data.length).toBeLessThanOrEqual(limit);
    seen.push(...page.data.map((generation) => generation.id));
    if (page.nextCursor === null) return seen;
    cursor = page.nextCursor;
  }
  throw new Error('pagination did not terminate');
}

describe('getGeneration', () => {
  it("returns the owner's generation with its outputs and input", async () => {
    const user = createUser(harness.db);
    const input = createAsset(harness.db, { userId: user.id });
    const gen = createGeneration(harness.db, {
      userId: user.id,
      status: 'succeeded',
      inputAssetId: input.id,
      tool: 'image-to-image',
    });
    const second = createAsset(harness.db, {
      userId: user.id,
      generationId: gen.id,
      role: 'output',
      index: 1,
    });
    const first = createAsset(harness.db, {
      userId: user.id,
      generationId: gen.id,
      role: 'output',
      index: 0,
    });
    const dto = await getGeneration(user.id, gen.id);
    expect(dto.outputs.map((output) => output.id)).toEqual([first.id, second.id]);
    expect(dto.input?.id).toBe(input.id);
  });

  it("is not_found for another user's generation, a missing one and a malformed id alike", async () => {
    const [owner, stranger] = [createUser(harness.db), createUser(harness.db)];
    const gen = createGeneration(harness.db, { userId: owner.id });
    const results = await Promise.all(
      [gen.id, newId('gen'), 'nonsense', '', "gen_' OR 1=1 --"].map((id) =>
        failure(getGeneration(stranger.id, id)),
      ),
    );
    for (const error of results) {
      expect(error).toMatchObject({
        code: 'not_found',
        status: 404,
        message: 'Generation not found',
      });
    }
  });
});

describe('listGenerations', () => {
  it("lists only the caller's generations, newest first", async () => {
    const [user, other] = [createUser(harness.db), createUser(harness.db)];
    const mine = seedMany(user.id, 3);
    seedMany(other.id, 2);
    const page = await listGenerations(user.id, {});
    expect(page.data.map((generation) => generation.id)).toEqual(
      mine.map((row) => row.id).toReversed(),
    );
    expect(page.nextCursor).toBeNull();
  });

  it('filters by kind, status, favorite and text', async () => {
    const user = createUser(harness.db);
    const image = createGeneration(harness.db, {
      userId: user.id,
      prompt: 'red fox',
      createdAt: BASE_TIME,
    });
    const video = createGeneration(harness.db, {
      userId: user.id,
      tool: 'text-to-video',
      prompt: 'blue whale',
      status: 'succeeded',
      createdAt: BASE_TIME + 1,
    });
    const fav = createGeneration(harness.db, {
      userId: user.id,
      prompt: 'green frog',
      isFavorite: true,
      status: 'failed',
      createdAt: BASE_TIME + 2,
    });
    const ids = async (query: Parameters<typeof listGenerations>[1]) =>
      (await listGenerations(user.id, query)).data.map((generation) => generation.id);

    expect(await ids({ kind: 'video' })).toEqual([video.id]);
    expect(await ids({ kind: 'image' })).toEqual([fav.id, image.id]);
    expect(await ids({ status: 'succeeded' })).toEqual([video.id]);
    expect(await ids({ status: 'failed' })).toEqual([fav.id]);
    expect(await ids({ favorite: true })).toEqual([fav.id]);
    expect(await ids({ favorite: false })).toEqual([video.id, image.id]);
    expect(await ids({ q: 'whale' })).toEqual([video.id]);
    expect(await ids({ q: '  FOX ' })).toEqual([image.id]);
    expect(await ids({ kind: 'image', status: 'failed', favorite: true, q: 'frog' })).toEqual([
      fav.id,
    ]);
    expect(await ids({ kind: 'video', favorite: true })).toEqual([]);
  });

  it('treats LIKE wildcards in the search text as plain characters', async () => {
    const user = createUser(harness.db);
    const percent = createGeneration(harness.db, {
      userId: user.id,
      prompt: 'a 100% cotton shirt',
      createdAt: BASE_TIME,
    });
    const underscore = createGeneration(harness.db, {
      userId: user.id,
      prompt: 'snake_case sign',
      createdAt: BASE_TIME + 1,
    });
    const slash = createGeneration(harness.db, {
      userId: user.id,
      prompt: String.raw`path C:\temp`,
      createdAt: BASE_TIME + 2,
    });
    createGeneration(harness.db, {
      userId: user.id,
      prompt: 'plain text',
      createdAt: BASE_TIME + 3,
    });
    const ids = async (q: string) =>
      (await listGenerations(user.id, { q })).data.map((generation) => generation.id);

    expect(await ids('100%')).toEqual([percent.id]);
    expect(await ids('%')).toEqual([percent.id]);
    expect(await ids('_')).toEqual([underscore.id]);
    expect(await ids('snake_case')).toEqual([underscore.id]);
    expect(await ids('snakeXcase')).toEqual([]);
    expect(await ids(String.raw`C:\t`)).toEqual([slash.id]);
    expect(await ids('\\')).toEqual([slash.id]);
    expect(await ids("' OR '1'='1")).toEqual([]);
  });

  it('searches Arabic text', async () => {
    const user = createUser(harness.db);
    const arabic = createGeneration(harness.db, {
      userId: user.id,
      prompt: 'قطة تجلس على النافذة',
    });
    createGeneration(harness.db, { userId: user.id, prompt: 'a cat' });
    expect(
      (await listGenerations(user.id, { q: 'النافذة' })).data.map((generation) => generation.id),
    ).toEqual([arabic.id]);
  });

  it("never returns another user's rows, whatever the filters", async () => {
    const [user, other] = [createUser(harness.db), createUser(harness.db)];
    const theirs = seedMany(other.id, 3, { isFavorite: true, status: 'succeeded' });
    for (const query of [
      {},
      { favorite: true },
      { status: 'succeeded' as const },
      { q: 'prompt' },
      { ids: theirs.map((row) => row.id) },
    ]) {
      expect((await listGenerations(user.id, query)).data).toEqual([]);
    }
  });

  describe('pagination', () => {
    it('walks every row exactly once even when all rows share one timestamp', async () => {
      const user = createUser(harness.db);
      const rows = seedMany(user.id, 53).map((row) => row.id);
      harness.db
        .update(generations)
        .set({ createdAt: BASE_TIME })
        .where(eq(generations.userId, user.id))
        .run();

      for (const limit of [1, 7, 20, 53, 100]) {
        const seen = await walk(user.id, {}, limit);
        expect(seen, `limit ${limit}`).toHaveLength(53);
        expect(new Set(seen).size).toBe(53);
        expect(new Set(seen)).toEqual(new Set(rows));
        expect(seen).toEqual(seen.toSorted().toReversed());
      }
    });

    it('is stable while new generations arrive between pages', async () => {
      const user = createUser(harness.db);
      const original = seedMany(user.id, 12).map((row) => row.id);
      const first = await listGenerations(user.id, { limit: 5 });
      // Newer rows land after the first page was fetched.
      const newer = createGeneration(harness.db, { userId: user.id, createdAt: BASE_TIME + 1000 });
      createGeneration(harness.db, { userId: user.id, createdAt: BASE_TIME + 1001 });

      const second = await listGenerations(user.id, {
        limit: 5,
        cursor: first.nextCursor ?? undefined,
      });
      const third = await listGenerations(user.id, {
        limit: 5,
        cursor: second.nextCursor ?? undefined,
      });
      const walked = [...first.data, ...second.data, ...third.data].map(
        (generation) => generation.id,
      );
      expect(walked).toEqual(original.toReversed());
      expect(walked).not.toContain(newer.id);
    });

    it('keeps the filters stable across pages', async () => {
      const user = createUser(harness.db);
      const videos = seedMany(user.id, 9, { tool: 'text-to-video' }).map((row) => row.id);
      seedMany(user.id, 9);
      const seen = await walk(user.id, { kind: 'video' }, 4);
      expect(seen).toEqual(videos.toReversed());
    });

    it('gives a cursor only when there is more', async () => {
      const user = createUser(harness.db);
      seedMany(user.id, 4);
      expect((await listGenerations(user.id, { limit: 4 })).nextCursor).toBeNull();
      expect((await listGenerations(user.id, { limit: 3 })).nextCursor).not.toBeNull();
    });

    it('rejects cursors that are not ours', async () => {
      const user = createUser(harness.db);
      for (const cursor of [
        'garbage!',
        'e30',
        btoa('[1,2]').replace(/=/g, ''),
        btoa('["a","b"]').replace(/=/g, ''),
        'x'.repeat(600),
      ]) {
        expect(await failure(listGenerations(user.id, { cursor }))).toMatchObject({
          code: 'bad_request',
        });
      }
    });

    it('clamps odd limits instead of failing', async () => {
      const user = createUser(harness.db);
      seedMany(user.id, 3);
      expect((await listGenerations(user.id, { limit: 0 })).data).toHaveLength(1);
      expect((await listGenerations(user.id, { limit: -5 })).data).toHaveLength(1);
      expect((await listGenerations(user.id, { limit: 10_000 })).data).toHaveLength(3);
      expect((await listGenerations(user.id, { limit: Number.NaN })).data).toHaveLength(3);
      expect((await listGenerations(user.id, { limit: 2.9 })).data).toHaveLength(2);
    });
  });

  describe('batch polling with ids', () => {
    it('returns exactly the named generations of the caller', async () => {
      const [user, other] = [createUser(harness.db), createUser(harness.db)];
      const mine = seedMany(user.id, 6);
      const theirs = seedMany(other.id, 1);
      const wanted = [mine[1], mine[4], theirs[0]].map((row) => row?.id ?? '');
      const page = await listGenerations(user.id, { ids: wanted });
      expect(page.data.map((generation) => generation.id)).toEqual([mine[4]?.id, mine[1]?.id]);
      expect(page.nextCursor).toBeNull();
    });

    it('shows progress and status changes, which is what the UI polls for', async () => {
      const user = createUser(harness.db);
      const [row] = seedMany(user.id, 1);
      harness.db
        .update(generations)
        .set({ status: 'processing', progress: 40 })
        .where(eq(generations.id, row?.id ?? ''))
        .run();
      const page = await listGenerations(user.id, { ids: [row?.id ?? ''] });
      expect(page.data[0]).toMatchObject({ status: 'processing', progress: 40 });
    });

    it('accepts the maximum of 50 and refuses 51', async () => {
      const user = createUser(harness.db);
      const rows = seedMany(user.id, 51).map((row) => row.id);
      expect((await listGenerations(user.id, { ids: rows.slice(0, 50) })).data).toHaveLength(50);
      const error = await failure(listGenerations(user.id, { ids: rows }));
      expect(error).toMatchObject({ code: 'validation_failed' });
      expect((error.details as { issues: Array<{ path: string }> }).issues[0]?.path).toBe('ids');
    });

    it('drops ids that cannot be generation ids and de-duplicates', async () => {
      const user = createUser(harness.db);
      const [row] = seedMany(user.id, 1);
      const id = row?.id ?? '';
      const page = await listGenerations(user.id, {
        ids: [id, id, 'nope', "x'; DROP TABLE generations;--", newId('usr')],
      });
      expect(page.data.map((generation) => generation.id)).toEqual([id]);
      expect((await listGenerations(user.id, { ids: ['nope'] })).data).toEqual([]);
      expect((await listGenerations(user.id, { ids: [] })).data).toEqual([]);
    });

    it('still applies the other filters', async () => {
      const user = createUser(harness.db);
      const [a, b] = seedMany(user.id, 2);
      harness.db
        .update(generations)
        .set({ status: 'failed' })
        .where(eq(generations.id, a?.id ?? ''))
        .run();
      const page = await listGenerations(user.id, {
        ids: [a?.id ?? '', b?.id ?? ''],
        status: 'failed',
      });
      expect(page.data.map((generation) => generation.id)).toEqual([a?.id]);
    });
  });

  it('does a fixed number of queries however many rows it returns', async () => {
    const user = createUser(harness.db);
    const input = createAsset(harness.db, { userId: user.id });
    const rows = seedMany(user.id, 40, { status: 'succeeded', inputAssetId: input.id });
    for (const row of rows) {
      createAsset(harness.db, { userId: user.id, generationId: row.id, role: 'output' });
    }
    const client = harness.db.$client;
    const original = client.prepare.bind(client);
    let prepared = 0;
    client.prepare = ((source: string) => {
      prepared += 1;
      return original(source);
    }) as typeof client.prepare;
    try {
      const page = await listGenerations(user.id, { limit: 40 });
      expect(page.data).toHaveLength(40);
      expect(page.data.every((generation) => generation.outputs.length === 1)).toBe(true);
      expect(prepared).toBeLessThanOrEqual(3);
    } finally {
      client.prepare = original as typeof client.prepare;
    }
  });
});

describe('the public feed', () => {
  function publish(userId: string, overrides: Partial<NewGenerationRow> = {}) {
    const row = createGeneration(harness.db, {
      userId,
      status: 'succeeded',
      isPublic: true,
      ...overrides,
    });
    createAsset(harness.db, { userId, generationId: row.id, role: 'output' });
    return row;
  }

  it("lists only public, succeeded generations, newest first, with the owner's display name", async () => {
    const [ann, bob] = [
      createUser(harness.db, { name: 'Ann' }),
      createUser(harness.db, { name: 'Bob' }),
    ];
    const first = publish(ann.id, { createdAt: BASE_TIME });
    const second = publish(bob.id, { createdAt: BASE_TIME + 1 });
    publish(ann.id, { createdAt: BASE_TIME + 2, isPublic: false });
    publish(ann.id, { createdAt: BASE_TIME + 3, status: 'failed' });
    publish(ann.id, { createdAt: BASE_TIME + 4, status: 'processing' });
    publish(ann.id, { createdAt: BASE_TIME + 5, status: 'canceled' });

    const feed = await listPublicGenerations({});
    expect(feed.data.map((generation) => generation.id)).toEqual([second.id, first.id]);
    expect(feed.data.map((generation) => generation.owner)).toEqual([
      { name: 'Bob' },
      { name: 'Ann' },
    ]);
    expect(feed.data[0]?.outputs).toHaveLength(1);
  });

  it('never leaks private fields', async () => {
    const owner = createUser(harness.db, { name: 'Ann', email: 'ann.secret@example.com' });
    const input = createAsset(harness.db, { userId: owner.id });
    const row = publish(owner.id, {
      isFavorite: true,
      inputAssetId: input.id,
      tool: 'image-to-image',
      negativePrompt: 'blurry',
    });
    const [dto] = (await listPublicGenerations({})).data;
    expect(dto).toBeDefined();
    const json = JSON.stringify(dto);
    for (const secret of [
      owner.id,
      owner.email,
      'ann.secret',
      input.id,
      input.storageKey,
      'provider',
      'worker',
      'lease',
      'idempotency',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(dto).not.toHaveProperty('input');
    expect(dto?.isFavorite).toBe(false);
    expect(dto?.owner).toEqual({ name: 'Ann' });
    expect(dto?.isPublic).toBe(true);
    expect(dto?.id).toBe(row.id);
  });

  it('hides everything an account shared once the account is disabled', async () => {
    const [good, banned] = [createUser(harness.db), createUser(harness.db)];
    const visible = publish(good.id);
    const hidden = publish(banned.id);
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, banned.id)).run();
    expect((await listPublicGenerations({})).data.map((generation) => generation.id)).toEqual([
      visible.id,
    ]);
    expect(getPublicGeneration(hidden.id)).toBeNull();
  });

  it('filters by kind and paginates stably', async () => {
    const user = createUser(harness.db);
    const images = Array.from({ length: 11 }, () => publish(user.id, { createdAt: BASE_TIME }).id);
    publish(user.id, { tool: 'text-to-video', createdAt: BASE_TIME });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listPublicGenerations({
        kind: 'image',
        limit: 4,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.data.map((generation) => generation.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen)).toEqual(new Set(images));
    expect(seen).toHaveLength(11);
    expect((await listPublicGenerations({ kind: 'video' })).data).toHaveLength(1);
  });

  it('rejects a bad cursor', async () => {
    expect(await failure(listPublicGenerations({ cursor: '!!!' }))).toMatchObject({
      code: 'bad_request',
    });
  });

  describe('getPublicGeneration', () => {
    it('returns a shared, succeeded generation with the owner name and no private fields', () => {
      const owner = createUser(harness.db, { name: 'Layla' });
      const row = publish(owner.id, { isFavorite: true });
      const dto = getPublicGeneration(row.id) as GenerationDTO;
      expect(dto).toMatchObject({
        id: row.id,
        owner: { name: 'Layla' },
        isFavorite: false,
        isPublic: true,
      });
      expect(dto.outputs).toHaveLength(1);
    });

    it.each([
      ['a private generation', { isPublic: false }],
      ['a failed one', { status: 'failed' as const }],
      ['a queued one', { status: 'queued' as const }],
    ])('returns null for %s', (_name, overrides) => {
      const owner = createUser(harness.db);
      expect(getPublicGeneration(publish(owner.id, overrides).id)).toBeNull();
    });

    it('returns null for unknown and malformed ids', () => {
      for (const id of [newId('gen'), 'x', '', 'ast_00000000000000000000000000', "gen_' or 1=1"]) {
        expect(getPublicGeneration(id)).toBeNull();
      }
    });
  });
});

describe('updateGeneration', () => {
  it('toggles the two flags independently', async () => {
    const user = createUser(harness.db);
    const row = createGeneration(harness.db, { userId: user.id });
    expect(await updateGeneration(user.id, row.id, { isPublic: true })).toMatchObject({
      isPublic: true,
      isFavorite: false,
    });
    expect(await updateGeneration(user.id, row.id, { isFavorite: true })).toMatchObject({
      isPublic: true,
      isFavorite: true,
    });
    expect(
      await updateGeneration(user.id, row.id, { isPublic: false, isFavorite: false }),
    ).toMatchObject({
      isPublic: false,
      isFavorite: false,
    });
  });

  it('changes nothing but the whitelisted flags', async () => {
    const [user, other] = [createUser(harness.db), createUser(harness.db)];
    const row = createGeneration(harness.db, { userId: user.id });
    const hostile = {
      isPublic: true,
      prompt: 'rewritten',
      status: 'succeeded',
      cost: 0,
      userId: other.id,
      provider: 'fal',
      id: 'gen_x',
      progress: 100,
    } as unknown as Parameters<typeof updateGeneration>[2];
    await updateGeneration(user.id, row.id, hostile);
    const after = harness.db.select().from(generations).where(eq(generations.id, row.id)).get();
    expect(after).toMatchObject({
      id: row.id,
      userId: user.id,
      prompt: row.prompt,
      status: 'queued',
      cost: row.cost,
      provider: 'mock',
      progress: 0,
      isPublic: true,
    });
  });

  it('ignores non-boolean values and leaves an empty patch as a read', async () => {
    const user = createUser(harness.db);
    const row = createGeneration(harness.db, { userId: user.id });
    const patch = { isPublic: 'yes', isFavorite: 1 } as unknown as Parameters<
      typeof updateGeneration
    >[2];
    expect(await updateGeneration(user.id, row.id, patch)).toMatchObject({
      isPublic: false,
      isFavorite: false,
    });
    expect(await updateGeneration(user.id, row.id, {})).toMatchObject({ id: row.id });
  });

  it("is not_found for someone else's generation and changes nothing", async () => {
    const [owner, stranger] = [createUser(harness.db), createUser(harness.db)];
    const row = createGeneration(harness.db, { userId: owner.id });
    for (const id of [row.id, newId('gen'), 'junk']) {
      expect(await failure(updateGeneration(stranger.id, id, { isPublic: true }))).toMatchObject({
        code: 'not_found',
      });
    }
    expect(await failure(updateGeneration(stranger.id, row.id, {}))).toMatchObject({
      code: 'not_found',
    });
    expect(
      harness.db.select().from(generations).where(eq(generations.id, row.id)).get()?.isPublic,
    ).toBe(false);
  });

  it('publishing makes the generation appear in the feed and unpublishing removes it', async () => {
    const user = createUser(harness.db);
    const row = createGeneration(harness.db, { userId: user.id, status: 'succeeded' });
    expect((await listPublicGenerations({})).data).toHaveLength(0);
    await updateGeneration(user.id, row.id, { isPublic: true });
    expect((await listPublicGenerations({})).data.map((generation) => generation.id)).toEqual([
      row.id,
    ]);
    await updateGeneration(user.id, row.id, { isPublic: false });
    expect((await listPublicGenerations({})).data).toHaveLength(0);
  });
});

describe('cancelGeneration', () => {
  it('cancels a queued generation and refunds it', async () => {
    const user = createUser(harness.db);
    const row = queue(harness.db, user, { cost: 4 });
    expect(getBalance(harness.db, user.id)).toBe(46);
    const dto = await cancelGeneration(user.id, row.id);
    expect(dto).toMatchObject({ id: row.id, status: 'canceled' });
    expect(dto.finishedAt).toBeGreaterThan(0);
    expect(getBalance(harness.db, user.id)).toBe(50);
    expectConsistentLedger(harness.db, user.id, 50);
  });

  it('cancels a processing generation, which its worker will then notice', async () => {
    const user = createUser(harness.db);
    const row = queue(harness.db, user);
    claimNextJob(harness.db, 'w1', 60_000);
    expect(await cancelGeneration(user.id, row.id)).toMatchObject({ status: 'canceled' });
    expect(getBalance(harness.db, user.id)).toBe(50);
  });

  it('is idempotent for a canceled generation and refunds only once', async () => {
    const user = createUser(harness.db);
    const row = queue(harness.db, user, { cost: 2 });
    await cancelGeneration(user.id, row.id);
    expect(await cancelGeneration(user.id, row.id)).toMatchObject({ status: 'canceled' });
    expect(getBalance(harness.db, user.id)).toBe(50);
    expect(harness.db.select().from(creditLedger).all()).toHaveLength(2);
  });

  it.each(['succeeded', 'failed'] as const)(
    'refuses to cancel a %s generation (409) and refunds nothing',
    async (status) => {
      const user = createUser(harness.db);
      const row = queue(harness.db, user, { status });
      const error = await failure(cancelGeneration(user.id, row.id));
      expect(error).toMatchObject({ code: 'conflict', status: 409 });
      expect(getBalance(harness.db, user.id)).toBe(49);
      expect(
        harness.db.select().from(generations).where(eq(generations.id, row.id)).get()?.status,
      ).toBe(status);
    },
  );

  it("is not_found for someone else's generation", async () => {
    const [owner, stranger] = [createUser(harness.db), createUser(harness.db)];
    const row = queue(harness.db, owner);
    expect(await failure(cancelGeneration(stranger.id, row.id))).toMatchObject({
      code: 'not_found',
    });
    expect(await failure(cancelGeneration(stranger.id, 'junk'))).toMatchObject({
      code: 'not_found',
    });
    expect(
      harness.db.select().from(generations).where(eq(generations.id, row.id)).get()?.status,
    ).toBe('queued');
    expect(getBalance(harness.db, owner.id)).toBe(49);
  });
});

describe('deleteGeneration', () => {
  let storage: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    storage = fakeStorage();
    setStorageOverride(storage);
  });
  afterEach(() => {
    setStorageOverride(null);
  });

  async function withFiles(userId: string) {
    const row = createGeneration(harness.db, { userId, status: 'succeeded' });
    const output = createAsset(harness.db, {
      userId,
      generationId: row.id,
      role: 'output',
      thumbKey: `u/${userId}/${row.id}/thumb.webp`,
    });
    await storage.put(output.storageKey, new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    await storage.put(output.thumbKey ?? '', new Uint8Array([4]), { mimeType: 'image/webp' });
    return { row, output };
  }

  it('removes the generation, its asset rows and its stored files', async () => {
    const user = createUser(harness.db);
    const { row, output } = await withFiles(user.id);
    await deleteGeneration(user.id, row.id);
    expect(
      harness.db.select().from(generations).where(eq(generations.id, row.id)).get(),
    ).toBeUndefined();
    expect(harness.db.select().from(assets).where(eq(assets.id, output.id)).get()).toBeUndefined();
    expect(storage.objects.size).toBe(0);
  });

  it('keeps the ledger rows but detaches them from the deleted generation', async () => {
    const user = createUser(harness.db);
    const row = queue(harness.db, user, { cost: 3, status: 'succeeded' });
    await deleteGeneration(user.id, row.id);
    const ledger = harness.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, user.id))
      .all();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: -3, generationId: null });
    expect(getBalance(harness.db, user.id)).toBe(47);
  });

  it('cancels and refunds a running generation before deleting it', async () => {
    const user = createUser(harness.db);
    const row = queue(harness.db, user, { cost: 5 });
    claimNextJob(harness.db, 'w1', 60_000);
    await deleteGeneration(user.id, row.id);
    expect(harness.db.select().from(generations).all()).toHaveLength(0);
    expect(getBalance(harness.db, user.id)).toBe(50);
    expectConsistentLedger(harness.db, user.id, 50);
  });

  it('refunds a queued generation too', async () => {
    const user = createUser(harness.db);
    const row = queue(harness.db, user, { cost: 5 });
    await deleteGeneration(user.id, row.id);
    expect(getBalance(harness.db, user.id)).toBe(50);
  });

  it('keeps the uploaded input image, which other generations may use', async () => {
    const user = createUser(harness.db);
    const input = createAsset(harness.db, { userId: user.id });
    await storage.put(input.storageKey, new Uint8Array([9]), { mimeType: 'image/png' });
    const row = createGeneration(harness.db, {
      userId: user.id,
      tool: 'image-to-image',
      inputAssetId: input.id,
      status: 'succeeded',
    });
    await deleteGeneration(user.id, row.id);
    expect(harness.db.select().from(assets).where(eq(assets.id, input.id)).get()).toBeDefined();
    expect(storage.objects.has(input.storageKey)).toBe(true);
  });

  it('still deletes when the stored files are already gone or the storage fails', async () => {
    const user = createUser(harness.db);
    const { row } = await withFiles(user.id);
    storage.objects.clear();
    await expect(deleteGeneration(user.id, row.id)).resolves.toBeUndefined();

    const second = await withFiles(user.id);
    storage.delete = () => Promise.reject(new Error('disk on fire'));
    await expect(deleteGeneration(user.id, second.row.id)).resolves.toBeUndefined();
    expect(
      harness.db.select().from(generations).where(eq(generations.id, second.row.id)).get(),
    ).toBeUndefined();
  });

  it("is not_found for someone else's generation and for a second delete", async () => {
    const [owner, stranger] = [createUser(harness.db), createUser(harness.db)];
    const { row, output } = await withFiles(owner.id);
    expect(await failure(deleteGeneration(stranger.id, row.id))).toMatchObject({
      code: 'not_found',
    });
    expect(
      harness.db.select().from(generations).where(eq(generations.id, row.id)).get(),
    ).toBeDefined();
    expect(storage.objects.has(output.storageKey)).toBe(true);

    await deleteGeneration(owner.id, row.id);
    expect(await failure(deleteGeneration(owner.id, row.id))).toMatchObject({ code: 'not_found' });
  });
});
