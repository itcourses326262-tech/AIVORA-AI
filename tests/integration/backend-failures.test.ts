import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { GenerationDTO, LedgerEntryDTO, UserDTO } from '@/lib/api-types';
import { newId } from '@/lib/id';
import { assets, generations } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { mockProvider } from '@/server/providers/mock';
import { getStorage, setStorageOverride } from '@/server/storage';
import { persistOutput } from '@/server/uploads';
import type { StorageDriver } from '@/server/storage/types';
import { expectConsistentLedger, ledgerInOrder } from '../helpers/credits';
import { makePng } from '../server/uploads/support';
import { dataOf, errorOf } from './helpers/api';
import {
  IMAGE_MODEL,
  VIDEO_MODEL,
  createWorld,
  runToCompletion,
  textToImage,
  textToVideo,
  waitFor,
  type Member,
} from './helpers/world';

// Everything that goes wrong between a request and a result, across the routes, the credits, the
// engine, the Demo provider (with its failure-injection words) and real storage: the user is
// refunded exactly once, the ledger stays consistent and no file is left behind.

// Real image and GIF encoding, scrypt and a job loop: slow when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const world = createWorld();

const balanceOf = async (member: Member) =>
  dataOf(await member.get<UserDTO>('/auth/me')).creditBalance;

const reasonsOf = (member: Member) =>
  ledgerInOrder(world.db, member.user.id).map((entry) => entry.reason);

const generationRows = () => world.db.select().from(generations).all();

const rowOf = (id: string) =>
  world.db.select().from(generations).where(eq(generations.id, id)).get();

const create = async (member: Member, body: unknown, headers?: Record<string, string>) =>
  dataOf(await member.post<GenerationDTO>('/generations', body, { headers }), 201);

/** Raises the active-generation limit so a test can queue more than the default four. */
function allowActive(limit: number): void {
  vi.stubEnv('MAX_ACTIVE_PER_USER', String(limit));
  resetEnvForTests();
}

describe('a generation that fails is refunded in full, once', () => {
  it('a provider failure after the wait: failed with a safe message, credit back, nothing stored', async () => {
    const alice = await world.signUp('Alice');
    const queued = await create(alice, textToImage('a calm lake __fail__'));
    expect(await balanceOf(alice)).toBe(49);

    const done = await runToCompletion(alice, queued.id, world.runner());
    expect(done.status).toBe('failed');
    expect(done.error).toEqual({
      code: 'unavailable',
      message: expect.stringContaining('simulated a failure'),
    });
    expect(done.outputs).toEqual([]);
    expect(rowOf(done.id)?.attempts).toBe(1); // a final error is not retried

    expect(await balanceOf(alice)).toBe(50);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'refund']);
    expectConsistentLedger(world.db, alice.user.id, 0);
    expect(world.storedFiles()).toEqual([]);
    expect(world.db.select().from(assets).all()).toEqual([]);

    const failedList = dataOf(
      await alice.get<GenerationDTO[]>('/generations', { query: { status: 'failed' } }),
    );
    expect(failedList.map((item) => item.id)).toEqual([done.id]);
  });

  it('a content-policy refusal by the provider is reported as such and refunded', async () => {
    const alice = await world.signUp('Alice');
    const queued = await create(alice, textToImage('a calm lake __content__'));
    const done = await runToCompletion(alice, queued.id, world.runner());
    expect(done).toMatchObject({ status: 'failed', error: { code: 'content_policy' } });
    expect(await balanceOf(alice)).toBe(50);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'refund']);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('a synchronous failure at submit time is refunded the same way', async () => {
    const alice = await world.signUp('Alice');
    const queued = await create(alice, textToImage('a calm lake __sync__ __fail__'));
    const done = await runToCompletion(alice, queued.id, world.runner());
    expect(done).toMatchObject({ status: 'failed', error: { code: 'unavailable' } });
    expect(await balanceOf(alice)).toBe(50);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('a failed video gives back the whole per-second price', async () => {
    const alice = await world.signUp('Alice');
    const queued = await create(
      alice,
      textToVideo('waves __fail__', { params: { durationSec: 5, resolution: '720p' } }),
    );
    expect(queued.cost).toBe(15);
    expect(await balanceOf(alice)).toBe(35);

    const done = await runToCompletion(alice, queued.id, world.runner());
    expect(done.status).toBe('failed');
    expect(await balanceOf(alice)).toBe(50);
    const ledger = dataOf(await alice.get<LedgerEntryDTO[]>('/account/ledger'));
    expect(ledger.map((entry) => entry.delta)).toEqual([15, -15, 50]);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('success, failure and refusal side by side: only the success is paid for', async () => {
    vi.stubEnv('WORKER_CONCURRENCY', '3');
    resetEnvForTests();
    const alice = await world.signUp('Alice');
    const [ok, broken, refused] = await Promise.all([
      create(alice, textToImage('a calm lake')),
      create(alice, textToImage('a calm lake __fail__')),
      create(alice, textToImage('a calm lake __content__')),
    ]);
    expect(await balanceOf(alice)).toBe(47);

    const runner = world.runner();
    const [okDone, brokenDone, refusedDone] = await Promise.all([
      runToCompletion(alice, ok.id, runner),
      runToCompletion(alice, broken.id, runner),
      runToCompletion(alice, refused.id, runner),
    ]);
    expect(okDone.status).toBe('succeeded');
    expect(brokenDone.status).toBe('failed');
    expect(refusedDone.status).toBe('failed');

    expect(await balanceOf(alice)).toBe(49);
    expectConsistentLedger(world.db, alice.user.id, 0);
    expect(reasonsOf(alice).toSorted()).toEqual(
      ['generation', 'generation', 'generation', 'refund', 'refund', 'signup_bonus'].toSorted(),
    );
    // Only the successful image (and its thumbnail) is in storage.
    expect(world.storedFiles()).toHaveLength(2);
  });

  it('a job that outlives its time limit fails with a timeout and is refunded', async () => {
    vi.stubEnv('GENERATION_TIMEOUT_SEC_IMAGE', '10');
    resetEnvForTests();
    const alice = await world.signUp('Alice');
    // `__slow__` makes the Demo job take 25 s; the limit is 10 s.
    const queued = await create(alice, textToImage('a very patient painting __slow__'));

    const done = await runToCompletion(alice, queued.id, world.runner());
    expect(done).toMatchObject({ status: 'failed', error: { code: 'timeout' } });
    expect(await balanceOf(alice)).toBe(50);
    expectConsistentLedger(world.db, alice.user.id, 0);
    expect(world.storedFiles()).toEqual([]);
  });
});

describe('canceling and deleting', () => {
  it('cancels a job that is already running at the provider: refund now, nothing stored later', async () => {
    const alice = await world.signUp('Alice');
    const upstreamCancel = vi.spyOn(mockProvider, 'cancel');
    const queued = await create(alice, textToImage('a slow sunrise __slow__'));
    const runner = world.runner();

    const running = runner.tick();
    await waitFor('the job to be submitted', () => {
      const row = rowOf(queued.id);
      return row?.status === 'processing' && row.providerJobId ? row : undefined;
    });
    expect(await balanceOf(alice)).toBe(49);

    const canceled = dataOf(await alice.post<GenerationDTO>(`/generations/${queued.id}/cancel`));
    expect(canceled).toMatchObject({ id: queued.id, status: 'canceled', outputs: [] });
    expect(await balanceOf(alice)).toBe(50);

    // The runner notices at its next poll, tells the provider and stops without storing anything.
    await running;
    await waitFor('the upstream cancel', () =>
      upstreamCancel.mock.calls.length > 0 ? true : undefined,
    );
    expect(upstreamCancel).toHaveBeenCalledTimes(1);
    expect(rowOf(queued.id)).toMatchObject({ status: 'canceled', errorCode: null });
    expect(world.db.select().from(assets).all()).toEqual([]);
    expect(world.storedFiles()).toEqual([]);

    // Canceling again changes nothing and refunds nothing more.
    const again = await alice.post<GenerationDTO>(`/generations/${queued.id}/cancel`);
    expect(dataOf(again).status).toBe('canceled');
    expect(await balanceOf(alice)).toBe(50);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'refund']);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('cancels a queued job before any worker saw it, and no worker resurrects it', async () => {
    const alice = await world.signUp('Alice');
    const queued = await create(
      alice,
      textToVideo('waves', { params: { durationSec: 5, resolution: '720p' } }),
    );
    expect(await balanceOf(alice)).toBe(35);

    const canceled = dataOf(await alice.post<GenerationDTO>(`/generations/${queued.id}/cancel`));
    expect(canceled.status).toBe('canceled');
    expect(await balanceOf(alice)).toBe(50);

    expect(await world.runner().tick()).toBe(0);
    expect((await alice.get<GenerationDTO>(`/generations/${queued.id}`)).json.data?.status).toBe(
      'canceled',
    );
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('cannot cancel what already finished, and a finished job keeps its charge', async () => {
    const alice = await world.signUp('Alice');
    const runner = world.runner();
    const good = await runToCompletion(
      alice,
      (await create(alice, textToImage('a calm lake'))).id,
      runner,
    );
    const bad = await runToCompletion(
      alice,
      (await create(alice, textToImage('a calm lake __fail__'))).id,
      runner,
    );
    expect(good.status).toBe('succeeded');
    expect(bad.status).toBe('failed');
    const balance = await balanceOf(alice);

    for (const finished of [good, bad]) {
      const reply = await alice.post(`/generations/${finished.id}/cancel`);
      expect(errorOf(reply, 409)).toBe('conflict');
    }
    expect(await balanceOf(alice)).toBe(balance);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('deleting a running generation refunds it, stops the worker and leaves no files', async () => {
    const alice = await world.signUp('Alice');
    const queued = await create(alice, textToImage('a slow sunrise __slow__'));
    const runner = world.runner();
    const running = runner.tick();
    await waitFor('the job to be submitted', () => {
      const row = rowOf(queued.id);
      return row?.providerJobId ? row : undefined;
    });

    const deleted = await alice.delete(`/generations/${queued.id}`);
    expect(deleted.status).toBe(204);
    await running;

    expect(rowOf(queued.id)).toBeUndefined();
    expect((await alice.get(`/generations/${queued.id}`)).status).toBe(404);
    expect(await balanceOf(alice)).toBe(50);
    expect(world.storedFiles()).toEqual([]);
    // The ledger keeps its rows, detached from the deleted generation.
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'refund']);
    expect(
      dataOf(await alice.get<LedgerEntryDTO[]>('/account/ledger')).map((e) => e.generationId),
    ).toEqual([undefined, undefined, undefined]);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it.each(['cancels', 'deletes'] as const)(
    'when the user %s a generation while its result is being stored, the files are removed and nothing is charged twice',
    async (action) => {
      const alice = await world.signUp('Alice');
      const queued = await create(alice, textToImage('a lake __sync__'));
      const stored = { files: 0 };
      const runner = world.runner({
        deps: {
          // The real storage step, then the user's click lands before the job can complete.
          persistOutput: async (...args) => {
            const output = await persistOutput(...args);
            stored.files = world.storedFiles().length;
            await (action === 'cancels'
              ? alice.post(`/generations/${queued.id}/cancel`)
              : alice.delete(`/generations/${queued.id}`));
            return output;
          },
        },
      });
      await runner.tick();

      expect(stored.files).toBe(2); // the files really were written first...
      expect(world.storedFiles()).toEqual([]); // ...and cleaned up when the job was dropped
      expect(world.db.select().from(assets).all()).toEqual([]);
      expect(await balanceOf(alice)).toBe(50);
      expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'refund']);
      expect(rowOf(queued.id)?.status).toBe(action === 'cancels' ? 'canceled' : undefined);
      expectConsistentLedger(world.db, alice.user.id, 0);
    },
  );

  it('deleting a finished generation removes its rows and files but keeps the charge', async () => {
    const alice = await world.signUp('Alice');
    const queued = await create(alice, textToImage('a calm lake'));
    const done = await runToCompletion(alice, queued.id, world.runner());
    const outputUrl = done.outputs[0]?.url ?? '';
    expect(world.storedFiles()).toHaveLength(2);

    expect((await alice.delete(`/generations/${done.id}`)).status).toBe(204);
    expect(world.storedFiles()).toEqual([]);
    expect((await alice.media(outputUrl)).status).toBe(404);
    expect(world.db.select().from(assets).all()).toEqual([]);
    expect(await balanceOf(alice)).toBe(49);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });
});

describe('credits, idempotency and limits', () => {
  it('refuses a request the balance cannot pay for (402) and queues nothing', async () => {
    const alice = await world.signUp('Alice');
    const longClip = textToVideo('waves', { params: { durationSec: 5, resolution: '720p' } });
    const spent = [
      await create(alice, longClip),
      await create(alice, longClip),
      await create(alice, longClip),
    ];
    expect(await balanceOf(alice)).toBe(5);

    const refused = await alice.post(
      '/generations',
      textToVideo('waves', { params: { durationSec: 3 } }),
      {
        headers: { 'idempotency-key': 'top-up-1' },
      },
    );
    expect(errorOf(refused, 402)).toBe('insufficient_credits');
    expect(refused.json.error?.details).toEqual({ required: 6, balance: 5 });

    expect(world.db.select().from(generations).all()).toHaveLength(3);
    expect(await balanceOf(alice)).toBe(5);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'generation', 'generation']);
    expect(world.storedFiles()).toEqual([]);

    // A refused request leaves nothing behind, not even its idempotency key: after canceling one
    // clip (15 credits back) the very same request with the very same key goes through.
    const [first] = spent;
    await alice.post(`/generations/${first?.id}/cancel`);
    expect(await balanceOf(alice)).toBe(20);
    const retried = await alice.post(
      '/generations',
      textToVideo('waves', { params: { durationSec: 3 } }),
      {
        headers: { 'idempotency-key': 'top-up-1' },
      },
    );
    expect(retried.status).toBe(201);
    expect(await balanceOf(alice)).toBe(14);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('spends the last credit exactly, then refuses at zero; the balance never goes negative', async () => {
    allowActive(10);
    const alice = await world.signUp('Alice');
    const longClip = textToVideo('waves', { params: { durationSec: 5, resolution: '720p' } });
    for (const body of [
      longClip,
      longClip,
      longClip,
      textToImage('four', { params: { count: 4 } }),
      textToImage('one'),
    ]) {
      await create(alice, body);
    }
    expect(await balanceOf(alice)).toBe(0);

    const refused = await alice.post('/generations', textToImage('one more'));
    expect(errorOf(refused, 402)).toBe('insufficient_credits');
    expect(refused.json.error?.details).toEqual({ required: 1, balance: 0 });
    expect(await balanceOf(alice)).toBe(0);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('answers a retried request with the original generation and charges once', async () => {
    const alice = await world.signUp('Alice');
    const body = textToImage('a calm lake');
    const key = { 'idempotency-key': 'retry-me-1' };

    const first = await alice.post<GenerationDTO>('/generations', body, { headers: key });
    const replay = await alice.post<GenerationDTO>('/generations', body, { headers: key });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.headers.get('location')).toBe(first.headers.get('location'));
    expect(dataOf(replay, 200).id).toBe(dataOf(first, 201).id);
    expect(await balanceOf(alice)).toBe(49);
    expect(world.db.select().from(generations).all()).toHaveLength(1);

    // After the job finished, the replay shows the finished job; still one charge.
    await runToCompletion(alice, dataOf(first, 201).id, world.runner());
    const late = await alice.post<GenerationDTO>('/generations', body, { headers: key });
    expect(late.status).toBe(200);
    expect(dataOf(late).status).toBe('succeeded');
    expect(await balanceOf(alice)).toBe(49);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('refuses to reuse a key for a different request, and keeps keys apart between users', async () => {
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const key = { 'idempotency-key': 'shared-key' };

    await create(alice, textToImage('a calm lake'), key);
    const other = await alice.post('/generations', textToImage('a different lake'), {
      headers: key,
    });
    expect(errorOf(other, 409)).toBe('conflict');
    expect(other.json.error?.details).toMatchObject({ reason: 'idempotency_key_reused' });
    expect(await balanceOf(alice)).toBe(49);

    // The same key from another account is a different key.
    const bobs = await bob.post<GenerationDTO>('/generations', textToImage('a calm lake'), {
      headers: key,
    });
    expect(bobs.status).toBe(201);
    expect(await balanceOf(bob)).toBe(49);

    for (const bad of ['', 'has space', 'x'.repeat(129), 'tab\there']) {
      const reply = await alice.post('/generations', textToImage('a calm lake'), {
        headers: { 'idempotency-key': bad },
      });
      expect(reply.status, `key ${JSON.stringify(bad)}`).toBe(422);
    }
    expect(await balanceOf(alice)).toBe(49);
  });

  it('five simultaneous requests with one key create one generation and one debit', async () => {
    const alice = await world.signUp('Alice');
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        alice.post<GenerationDTO>('/generations', textToImage('a calm lake'), {
          headers: { 'idempotency-key': 'double-click' },
        }),
      ),
    );
    expect(replies.map((reply) => reply.status).toSorted()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(replies.map((reply) => reply.json.data?.id)).size).toBe(1);
    expect(await balanceOf(alice)).toBe(49);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation']);
  });

  it('stops a fifth active generation (429), charges nothing for it and still replays an old one', async () => {
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const queued: GenerationDTO[] = [];
    for (let index = 0; index < 4; index += 1) {
      queued.push(
        await create(alice, textToImage(`lake ${index}`), { 'idempotency-key': `lake-${index}` }),
      );
    }
    expect(await balanceOf(alice)).toBe(46);

    const refused = await alice.post('/generations', textToImage('one too many'));
    expect(errorOf(refused, 429)).toBe('too_many_active');
    expect(refused.json.error?.details).toEqual({ limit: 4 });
    expect(await balanceOf(alice)).toBe(46);
    expect(world.db.select().from(generations).all()).toHaveLength(4);

    // A retry of an accepted request is not a new one, even at the limit.
    const replay = await alice.post<GenerationDTO>('/generations', textToImage('lake 0'), {
      headers: { 'idempotency-key': 'lake-0' },
    });
    expect(replay.status).toBe(200);
    expect(dataOf(replay).id).toBe(queued[0]?.id);

    // Other accounts are not affected, and a finished or canceled job frees a slot.
    expect((await bob.post('/generations', textToImage('bob lake'))).status).toBe(201);
    await alice.post(`/generations/${queued[0]?.id}/cancel`);
    expect((await alice.post('/generations', textToImage('one more'))).status).toBe(201);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('limits starting generations to 30 a minute per user, before any credits are touched', async () => {
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    // Invalid bodies still spend the route's budget; none of them can cost credits.
    for (let index = 0; index < 30; index += 1) {
      expect((await alice.post('/generations', { tool: 'text-to-image' })).status).toBe(422);
    }
    const limited = await alice.post('/generations', textToImage('a calm lake'));
    expect(errorOf(limited, 429)).toBe('rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.headers.get('x-ratelimit-limit')).toBe('30');
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(await balanceOf(alice)).toBe(50);

    // Reads have their own budget; another user has theirs; the window ends.
    expect((await alice.get('/generations')).status).toBe(200);
    expect((await bob.post('/generations', textToImage('bobs lake'))).status).toBe(201);
    world.time.skip(61_000);
    expect((await alice.post('/generations', textToImage('a calm lake'))).status).toBe(201);
    expect(await balanceOf(alice)).toBe(49);
  });

  it('limits uploads to 20 a minute per user', async () => {
    const alice = await world.signUp('Alice');
    const png = await makePng(16, 16);
    for (let index = 0; index < 20; index += 1) {
      expect((await alice.upload(png)).status).toBe(201);
    }
    const limited = await alice.upload(png);
    expect(errorOf(limited, 429)).toBe('rate_limited');
    expect(world.db.select().from(assets).all()).toHaveLength(20);
  });
});

describe('requests that are refused before they cost anything', () => {
  const invalid: Array<[string, unknown]> = [
    ['an unknown model', { tool: 'text-to-image', modelId: 'no-such-model', prompt: 'a lake' }],
    [
      'a video model for an image tool',
      { tool: 'text-to-image', modelId: VIDEO_MODEL, prompt: 'a lake' },
    ],
    ['more images than the model makes', textToImage('a lake', { params: { count: 5 } })],
    ['an aspect ratio the model lacks', textToImage('a lake', { params: { aspectRatio: '21:9' } })],
    ['a duration the model lacks', textToVideo('waves', { params: { durationSec: 4 } })],
    ['a resolution the model lacks', textToVideo('waves', { params: { resolution: '1080p' } })],
    ['a seed out of range', textToImage('a lake', { params: { seed: -1 } })],
    ['a prompt over the image model limit', textToImage('x'.repeat(2001))],
    ['a prompt over the video model limit', textToVideo('x'.repeat(1001))],
    ['a blank prompt', textToImage('   ')],
    ['an invisible prompt', textToImage('\u200b\u200b')],
    [
      'an image tool without an input image',
      { tool: 'image-to-image', modelId: IMAGE_MODEL, prompt: 'warmer' },
    ],
    ['an input image on a text tool', textToImage('a lake', { inputAssetId: newId('ast') })],
    ['strength on a text tool', textToImage('a lake', { params: { strength: 0.5 } })],
    [
      'a negative prompt on a model without support',
      textToVideo('waves', { negativePrompt: 'blurry' }),
    ],
    ['an unknown field', { ...textToImage('a lake'), admin: true }],
  ];

  it.each(invalid)('refuses %s with 422 and field details', async (_name, body) => {
    const alice = await world.signUp('Alice');
    const reply = await alice.post('/generations', body);
    expect(errorOf(reply, 422)).toBe('validation_failed');
    expect(reply.json.error?.details).toMatchObject({ issues: expect.any(Array) });
    expect(await balanceOf(alice)).toBe(50);
    expect(generationRows()).toHaveLength(0);
    expect(reasonsOf(alice)).toEqual(['signup_bonus']);
  });

  it('refuses unreadable or oversized bodies with 400 and 413', async () => {
    const alice = await world.signUp('Alice');
    const malformed = await alice.post('/generations', '{"tool": "text-to-image",', {
      headers: { 'content-type': 'application/json' },
    });
    expect(malformed.status).toBe(400);
    const huge = await alice.post(
      '/generations',
      JSON.stringify(textToImage('x'.repeat(70 * 1024))),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(errorOf(huge, 413)).toBe('payload_too_large');
    expect(await balanceOf(alice)).toBe(50);
    expect(generationRows()).toHaveLength(0);
  });

  it('fills in the model defaults and prices them', async () => {
    const alice = await world.signUp('Alice');
    const clip = dataOf(await alice.post<GenerationDTO>('/generations', textToVideo('waves')), 201);
    expect(clip.params).toEqual({
      aspectRatio: '16:9',
      count: 1,
      durationSec: 3,
      resolution: '480p',
    });
    expect(clip.cost).toBe(6);
    const picture = dataOf(
      await alice.post<GenerationDTO>('/generations', textToImage('a lake')),
      201,
    );
    expect(picture.params).toEqual({ aspectRatio: '1:1', count: 1 });
    expect(await balanceOf(alice)).toBe(43);
  });
});

describe('simultaneous requests', () => {
  it('ten at once against the limit of four: exactly four are accepted and charged', async () => {
    const alice = await world.signUp('Alice');
    const replies = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        alice.post('/generations', textToImage(`lake ${index}`)),
      ),
    );
    expect(replies.map((reply) => reply.status).toSorted()).toEqual([
      201, 201, 201, 201, 429, 429, 429, 429, 429, 429,
    ]);
    for (const reply of replies.filter((candidate) => candidate.status === 429)) {
      expect(errorOf(reply, 429)).toBe('too_many_active');
    }
    expect(generationRows()).toHaveLength(4);
    expect(await balanceOf(alice)).toBe(46);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('five 15-credit clips at once with 50 credits: three are accepted, two get 402, the balance never dips below zero', async () => {
    allowActive(10);
    const alice = await world.signUp('Alice');
    const clip = textToVideo('waves', { params: { durationSec: 5, resolution: '720p' } });
    const replies = await Promise.all(
      Array.from({ length: 5 }, () => alice.post('/generations', clip)),
    );
    expect(replies.map((reply) => reply.status).toSorted()).toEqual([201, 201, 201, 402, 402]);
    expect(await balanceOf(alice)).toBe(5);
    expect(generationRows()).toHaveLength(3);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });
});

describe('storage trouble', () => {
  function flaky(real: StorageDriver, failOn: (key: string) => boolean): StorageDriver {
    return {
      ...real,
      put: async (key, body, options) => {
        if (failOn(key)) throw new Error('simulated disk failure');
        return real.put(key, body, options);
      },
    };
  }

  it('a failure while saving the result fails the job with a generic message, refunds it and leaves no file behind', async () => {
    const alice = await world.signUp('Alice');
    const queued = await create(alice, textToImage('a lake'));
    // The picture is written, then its thumbnail fails: the picture must not stay as an orphan.
    setStorageOverride(flaky(getStorage(), (key) => key.endsWith('.thumb.webp')));
    const done = await runToCompletion(alice, queued.id, world.runner());

    expect(done).toMatchObject({ status: 'failed', error: { code: 'internal' } });
    expect(JSON.stringify(done)).not.toContain('disk');
    expect(done.outputs).toEqual([]);
    expect(await balanceOf(alice)).toBe(50);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'refund']);
    expect(world.storedFiles()).toEqual([]);
    expect(world.db.select().from(assets).all()).toEqual([]);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('a result whose file vanished from storage is a 404, not a server error', async () => {
    const alice = await world.signUp('Alice');
    const done = await runToCompletion(
      alice,
      (await create(alice, textToImage('a lake'))).id,
      world.runner(),
    );
    const [file] = world.storedFiles().filter((name) => !name.includes('.thumb.'));
    expect(file).toBeDefined();
    rmSync(join(world.storageDir, file ?? ''));

    const missing = await alice.media(done.outputs[0]?.url ?? '');
    expect(missing.status).toBe(404);
    expect((await alice.media(done.outputs[0]?.thumbUrl ?? '')).status).toBe(200);
    expect((await alice.get(`/generations/${done.id}`)).status).toBe(200);
  });
});
