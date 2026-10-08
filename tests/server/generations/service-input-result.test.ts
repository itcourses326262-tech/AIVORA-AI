import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreateGenerationRequest } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { getBalance } from '@/server/credits';
import { assets, generations, type NewAssetRow, type UserRow } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { cancelGeneration, createGeneration, deleteGeneration } from '@/server/generations/service';
import { setProviderOverrides } from '@/server/providers/registry';
import { freshDb } from '../../helpers/db';
import {
  createAsset,
  createGeneration as insertGeneration,
  createUser,
} from '../../helpers/factories';

/*
 * Iterating on a result is the core flow of the studio: "edit this picture" and "animate this
 * picture" start from an image the user's own generation produced. An uploaded input is accepted
 * as before; an output is accepted when it is an IMAGE of the caller; everything else is the same
 * not_found as a missing asset.
 */

const harness = freshDb();

beforeEach(() => setProviderOverrides(null));
afterEach(() => {
  setProviderOverrides(null);
  resetEnvForTests();
});

const edit = (inputAssetId: string): CreateGenerationRequest => ({
  tool: 'image-to-image',
  modelId: 'aivore-demo-image',
  prompt: 'turn it into a watercolor',
  inputAssetId,
});
const animate = (inputAssetId: string): CreateGenerationRequest => ({
  tool: 'image-to-video',
  modelId: 'aivore-demo-video',
  prompt: 'slow push-in',
  inputAssetId,
});

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

/** A finished generation of `user` with one output asset. */
function result(user: UserRow, overrides: Partial<NewAssetRow> = {}) {
  const generation = insertGeneration(harness.db, { userId: user.id, status: 'succeeded' });
  const output = createAsset(harness.db, {
    userId: user.id,
    role: 'output',
    generationId: generation.id,
    ...overrides,
  });
  return { generation, output };
}

describe('a result as the input image', () => {
  it('starts image-to-image from the output of an earlier generation', async () => {
    const user = createUser(harness.db);
    const { output } = result(user);
    const created = await createGeneration(user.id, edit(output.id));
    expect(created.created).toBe(true);
    expect(created.generation).toMatchObject({ tool: 'image-to-image', status: 'queued', cost: 1 });
    // The DTO shows the picture the generation started from.
    expect(created.generation.input).toMatchObject({ id: output.id, kind: 'image' });
    expect(
      harness.db.select().from(generations).where(eq(generations.id, created.generation.id)).get(),
    ).toMatchObject({ inputAssetId: output.id, userId: user.id });
    expect(getBalance(harness.db, user.id)).toBe(49);
  });

  it('starts image-to-video from the output of an earlier generation', async () => {
    const user = createUser(harness.db);
    const { output } = result(user);
    const { generation } = await createGeneration(user.id, animate(output.id));
    expect(generation).toMatchObject({ tool: 'image-to-video', status: 'queued' });
    expect(generation.input?.id).toBe(output.id);
  });

  it('still accepts a plain upload', async () => {
    const user = createUser(harness.db);
    const upload = createAsset(harness.db, { userId: user.id });
    const { generation } = await createGeneration(user.id, edit(upload.id));
    expect(generation.input?.id).toBe(upload.id);
  });

  it("never accepts somebody else's result, public or not", async () => {
    const alice = createUser(harness.db);
    const bob = createUser(harness.db);
    const shared = insertGeneration(harness.db, {
      userId: alice.id,
      status: 'succeeded',
      isPublic: true,
    });
    const aliceOutput = createAsset(harness.db, {
      userId: alice.id,
      role: 'output',
      generationId: shared.id,
    });
    const error = await failure(createGeneration(bob.id, edit(aliceOutput.id)));
    expect(error).toMatchObject({ code: 'not_found', status: 404 });
    expect(getBalance(harness.db, bob.id)).toBe(50);

    // The answer is the one for an asset that does not exist at all.
    const missing = await failure(createGeneration(bob.id, edit('ast_00000000000000000000000000')));
    expect(error.message).toBe(missing.message);
    expect(error.details).toEqual(missing.details);
  });

  it('never accepts a video, whatever its role', async () => {
    const user = createUser(harness.db);
    const { output: clip } = result(user, {
      kind: 'video',
      mimeType: 'image/gif',
      durationMs: 3000,
    });
    const upload = createAsset(harness.db, {
      userId: user.id,
      kind: 'video',
      mimeType: 'video/mp4',
    });
    for (const asset of [clip, upload]) {
      for (const request of [edit(asset.id), animate(asset.id)]) {
        expect(await failure(createGeneration(user.id, request))).toMatchObject({
          code: 'not_found',
        });
      }
    }
    expect(getBalance(harness.db, user.id)).toBe(50);
    expect(
      harness.db
        .select()
        .from(generations)
        .all()
        .filter((row) => row.status === 'queued'),
    ).toHaveLength(0);
  });

  it('is replay-safe: the same key and the same result is the same generation', async () => {
    const user = createUser(harness.db);
    const { output } = result(user);
    const first = await createGeneration(user.id, edit(output.id), { idempotencyKey: 'again-1' });
    const replay = await createGeneration(user.id, edit(output.id), { idempotencyKey: 'again-1' });
    expect(replay).toMatchObject({ created: false, generation: { id: first.generation.id } });
    const other = result(user).output;
    expect(
      await failure(createGeneration(user.id, edit(other.id), { idempotencyKey: 'again-1' })),
    ).toMatchObject({ code: 'conflict' });
  });

  it('counts the same as any other generation against the active limit and the balance', async () => {
    const user = createUser(harness.db, { creditBalance: 1 });
    const { output } = result(user);
    await createGeneration(user.id, edit(output.id));
    expect(await failure(createGeneration(user.id, edit(output.id)))).toMatchObject({
      code: 'insufficient_credits',
    });
  });
});

describe('when the source result goes away', () => {
  it('deleting the source detaches the input of a later generation instead of breaking it', async () => {
    const user = createUser(harness.db);
    const { generation: source, output } = result(user);
    const { generation: child } = await createGeneration(user.id, edit(output.id));

    await deleteGeneration(user.id, source.id);

    expect(harness.db.select().from(assets).where(eq(assets.id, output.id)).get()).toBeUndefined();
    const row = harness.db.select().from(generations).where(eq(generations.id, child.id)).get();
    expect(row).toMatchObject({ status: 'queued', inputAssetId: null });
    // A queued child can no longer run (the runner fails it with a refund, see input-from-result.test.ts)
    // but it can always be canceled, and canceling refunds.
    await cancelGeneration(user.id, child.id);
    expect(getBalance(harness.db, user.id)).toBe(50);
  });
});
