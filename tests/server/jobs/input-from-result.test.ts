import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { generations } from '@/server/db/schema';
import { createAsset, createGeneration, createUser } from '../../helpers/factories';
import { TINY_PNG, fakeProvider } from '../../helpers/fakes';
import { createHarness, type Harness } from './support';

/*
 * The runner reads the input image back from storage on every claim. Since an output of the
 * user's own may be the input (image-to-image / image-to-video "from a result"), it must load an
 * `output` asset exactly like an upload, and still refuse anything that is not the user's.
 */

const open: Harness[] = [];
afterEach(() => {
  for (const item of open.splice(0)) item.close();
});

function harness(): Harness {
  const created = createHarness({
    provider: fakeProvider({
      submit: () => ({ mode: 'async', providerJobId: 'job-1', meta: { v: 1 } }),
      poll: () => ({
        status: 'succeeded',
        outputs: [{ kind: 'image', bytes: TINY_PNG, mimeType: 'image/png' }],
      }),
    }),
  });
  open.push(created);
  return created;
}

async function ownResult(h: Harness, userId: string) {
  const source = createGeneration(h.db, { userId, status: 'succeeded' });
  const asset = createAsset(h.db, {
    userId,
    role: 'output',
    generationId: source.id,
    width: 1024,
    height: 768,
    mimeType: 'image/png',
  });
  await h.storage.put(asset.storageKey, TINY_PNG, { mimeType: 'image/png' });
  return asset;
}

describe('an earlier result as the input image', () => {
  it("hands the bytes of the user's own output to the provider, on submit and on poll", async () => {
    const h = harness();
    const asset = await ownResult(h, h.user.id);
    const job = h.enqueue({ tool: 'image-to-image', inputAssetId: asset.id });
    await h.runner.tick();

    expect(h.row(job.id).status).toBe('succeeded');
    for (const input of [
      h.provider.submit.mock.calls[0]?.[0],
      h.provider.poll.mock.calls[0]?.[1],
    ]) {
      expect(input?.inputImage).toMatchObject({ mimeType: 'image/png', width: 1024, height: 768 });
      expect([...(input?.inputImage?.bytes ?? [])]).toEqual([...TINY_PNG]);
    }
    expect(h.balance()).toBe(49);
  });

  it("still fails with a refund for somebody else's output", async () => {
    const h = harness();
    const stranger = createUser(h.db);
    const theirs = await ownResult(h, stranger.id);
    const job = h.enqueue({ tool: 'image-to-image', inputAssetId: theirs.id, cost: 2 });
    await h.runner.tick();

    expect(h.row(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'invalid_input',
      errorMessage: 'The input image is no longer available.',
    });
    expect(h.provider.submit).not.toHaveBeenCalled();
    expect(h.balance()).toBe(50);
  });

  it('fails with a refund when the source result was deleted while the job waited in the queue', async () => {
    const h = harness();
    const asset = await ownResult(h, h.user.id);
    const job = h.enqueue({ tool: 'image-to-image', inputAssetId: asset.id, cost: 2 });
    // What deleteGeneration of the source does: its assets go, the foreign key detaches the child.
    h.db
      .delete(generations)
      .where(eq(generations.id, asset.generationId ?? ''))
      .run();
    h.storage.objects.clear();

    await h.runner.tick();
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'invalid_input' });
    expect(h.provider.submit).not.toHaveBeenCalled();
    expect(h.balance()).toBe(50);
  });
});
