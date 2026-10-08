import http from 'node:http';
import https from 'node:https';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { assets } from '@/server/db/schema';
import { markCanceled } from '@/server/generations/lifecycle';
import type { ProviderOutput } from '@/server/providers/types';
import { setSsrfResolverForTests, type SafeFetchResult } from '@/server/security/ssrf';
import { expectConsistentLedger } from '../../helpers/credits';
import { TINY_GIF, TINY_PNG, fakeProvider } from '../../helpers/fakes';
import { createHarness, type Harness, type HarnessOptions } from './support';

type Fetch = NonNullable<HarnessOptions['fetchOutput']>;

const open: Harness[] = [];

function harness(options?: HarnessOptions): Harness {
  const created = createHarness(options);
  open.push(created);
  return created;
}

afterEach(() => {
  for (const item of open.splice(0)) item.close();
  setSsrfResolverForTests(null);
  vi.restoreAllMocks();
});

const MB = 1024 * 1024;

const reply = (
  bytes: Uint8Array,
  contentType: string,
  url = 'https://cdn.example/x',
): SafeFetchResult => ({
  bytes,
  contentType,
  finalUrl: url,
});

function providerReturning(outputs: ProviderOutput[]) {
  return fakeProvider({ submit: () => ({ mode: 'sync', outputs }) });
}

const stored = (h: Harness, id: string) =>
  h.test.db.select().from(assets).where(eq(assets.generationId, id)).orderBy(assets.index).all();

describe('downloading provider output urls', () => {
  it('fetches each url through the SSRF-safe fetch with the documented limits', async () => {
    const fetchOutput = vi.fn<Fetch>(async (url) => reply(TINY_PNG, 'image/png', url));
    const h = harness({
      fetchOutput,
      provider: providerReturning([{ kind: 'image', url: 'https://cdn.example/a.png' }]),
    });
    const job = h.enqueue();
    await h.runner.tick();

    expect(h.row(job.id).status).toBe('succeeded');
    expect(fetchOutput).toHaveBeenCalledTimes(1);
    const [url, options] = fetchOutput.mock.calls[0] ?? [];
    expect(url).toBe('https://cdn.example/a.png');
    expect(options).toMatchObject({
      maxBytes: 64 * MB,
      allowedContentTypes: ['image/*', 'video/*'],
      signal: expect.any(AbortSignal),
    });
    expect(options?.timeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(options?.timeoutMs).toBeLessThanOrEqual(5 * 60_000);
    expect(stored(h, job.id)).toHaveLength(1);
  });

  it('allows 500 MB for a video and passes the duration along', async () => {
    const fetchOutput = vi.fn<Fetch>(async () => reply(TINY_GIF, 'video/mp4'));
    const h = harness({
      fetchOutput,
      provider: providerReturning([
        { kind: 'video', url: 'https://cdn.example/v.mp4', durationMs: 5000 },
      ]),
    });
    const job = h.enqueue({
      tool: 'text-to-video',
      params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '480p' },
      cost: 10,
    });
    await h.runner.tick();
    expect(fetchOutput.mock.calls[0]?.[1].maxBytes).toBe(500 * MB);
    expect(h.persist.mock.calls[0]?.[1]).toMatchObject({
      kind: 'video',
      durationMs: 5000,
      mimeType: 'video/mp4',
    });
    expect(stored(h, job.id)[0]).toMatchObject({ kind: 'video', durationMs: 5000 });
  });

  it('prefers the type the provider declared and falls back to the response type', async () => {
    const fetchOutput = vi.fn<Fetch>(async () => reply(TINY_PNG, 'image/webp'));
    const h = harness({
      fetchOutput,
      provider: providerReturning([
        { kind: 'image', url: 'https://cdn.example/a', mimeType: 'image/png' },
        { kind: 'image', url: 'https://cdn.example/b' },
      ]),
    });
    h.enqueue({ params: { aspectRatio: '1:1', count: 2 }, cost: 2 });
    await h.runner.tick();
    expect(h.persist.mock.calls.map((call) => call[1].mimeType)).toEqual([
      'image/png',
      'image/webp',
    ]);
  });

  it('prefers bytes over a url when a provider sends both', async () => {
    const fetchOutput = vi.fn<Fetch>();
    const h = harness({
      fetchOutput,
      provider: providerReturning([
        {
          kind: 'image',
          bytes: TINY_PNG,
          mimeType: 'image/png',
          url: 'https://cdn.example/ignored',
        },
      ]),
    });
    h.enqueue();
    await h.runner.tick();
    expect(fetchOutput).not.toHaveBeenCalled();
  });

  it('fetches a video preview with the image-only allowlist and stores it as the thumbnail input', async () => {
    const fetchOutput = vi.fn<Fetch>(async (url) =>
      url.endsWith('.jpg') ? reply(TINY_PNG, 'image/jpeg') : reply(TINY_GIF, 'video/mp4'),
    );
    const h = harness({
      fetchOutput,
      provider: providerReturning([
        { kind: 'video', url: 'https://cdn.example/v.mp4', thumbUrl: 'https://cdn.example/t.jpg' },
      ]),
    });
    h.enqueue({
      tool: 'text-to-video',
      params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '480p' },
      cost: 10,
    });
    await h.runner.tick();
    const thumbCall = fetchOutput.mock.calls.find(([url]) => url.endsWith('.jpg'));
    expect(thumbCall?.[1]).toMatchObject({ allowedContentTypes: ['image/*'], maxBytes: 10 * MB });
    expect(h.persist.mock.calls[0]?.[1].thumbBytes).toEqual(TINY_PNG);
  });

  it('does not lose a video because its preview could not be fetched', async () => {
    const fetchOutput = vi.fn<Fetch>(async (url) => {
      if (url.endsWith('.jpg')) throw AppError.of('bad_request', 'URL is not allowed');
      return reply(TINY_GIF, 'video/mp4');
    });
    const h = harness({
      fetchOutput,
      provider: providerReturning([
        { kind: 'video', url: 'https://cdn.example/v.mp4', thumbUrl: 'https://cdn.example/t.jpg' },
      ]),
    });
    const job = h.enqueue({
      tool: 'text-to-video',
      params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '480p' },
      cost: 10,
    });
    await h.runner.tick();
    expect(h.row(job.id).status).toBe('succeeded');
    expect(h.persist.mock.calls[0]?.[1]).not.toHaveProperty('thumbBytes');
  });

  it('retries a transient download failure once, a second later', async () => {
    let calls = 0;
    const fetchOutput = vi.fn<Fetch>(async () => {
      calls += 1;
      if (calls === 1) throw AppError.of('provider_error', 'Download failed');
      return reply(TINY_PNG, 'image/png');
    });
    const h = harness({
      fetchOutput,
      provider: providerReturning([{ kind: 'image', url: 'https://cdn.example/a.png' }]),
    });
    const job = h.enqueue();
    await h.clock.runUntil(h.runner.tick());
    expect(h.row(job.id).status).toBe('succeeded');
    expect(calls).toBe(2);
    expect(h.clock.sleeps).toContain(1000);
  });

  it('gives up on an output after the retry and fails the job when it was the only one', async () => {
    const fetchOutput = vi.fn<Fetch>(async () => {
      throw AppError.of('provider_error', 'Download failed');
    });
    const h = harness({
      fetchOutput,
      provider: providerReturning([{ kind: 'image', url: 'https://cdn.example/a.png' }]),
    });
    const job = h.enqueue({ cost: 2 });
    await h.clock.runUntil(h.runner.tick());
    expect(fetchOutput).toHaveBeenCalledTimes(2);
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
    expect(h.balance()).toBe(50);
  });

  it('does not retry a url that was refused or is not an allowed type', async () => {
    for (const refusal of [
      AppError.of('bad_request', 'URL is not allowed'),
      AppError.of('unsupported_media_type', 'Content type not allowed'),
      AppError.of('payload_too_large', 'Too big'),
    ]) {
      const fetchOutput = vi.fn<Fetch>(async () => {
        throw refusal;
      });
      const h = harness({
        fetchOutput,
        provider: providerReturning([{ kind: 'image', url: 'https://cdn.example/a.png' }]),
      });
      const job = h.enqueue();
      await h.runner.tick();
      expect(fetchOutput).toHaveBeenCalledTimes(1);
      expect(h.row(job.id).status).toBe('failed');
      expect(h.balance()).toBe(50);
    }
  });

  it('delivers the outputs that could be downloaded and refunds the rest', async () => {
    const fetchOutput = vi.fn<Fetch>(async (url) => {
      if (url.includes('bad')) throw AppError.of('bad_request', 'URL is not allowed');
      return reply(TINY_PNG, 'image/png', url);
    });
    const h = harness({
      fetchOutput,
      provider: providerReturning([
        { kind: 'image', url: 'https://cdn.example/1.png' },
        { kind: 'image', url: 'https://cdn.example/bad.png' },
        { kind: 'image', url: 'https://cdn.example/3.png' },
      ]),
    });
    const job = h.enqueue({ params: { aspectRatio: '1:1', count: 3 }, cost: 6 });
    await h.runner.tick();

    expect(h.row(job.id).status).toBe('succeeded');
    expect(stored(h, job.id).map((asset) => asset.index)).toEqual([0, 1]);
    expect(h.balance()).toBe(50 - 6 + 2);
    expectConsistentLedger(h.db, h.user.id, 50);
  });

  it('never fetches more urls than outputs were requested', async () => {
    const fetchOutput = vi.fn<Fetch>(async () => reply(TINY_PNG, 'image/png'));
    const h = harness({
      fetchOutput,
      provider: providerReturning(
        Array.from({ length: 10 }, (_, index) => ({
          kind: 'image' as const,
          url: `https://cdn.example/${index}.png`,
        })),
      ),
    });
    h.enqueue({ params: { aspectRatio: '1:1', count: 2 }, cost: 2 });
    await h.runner.tick();
    expect(fetchOutput).toHaveBeenCalledTimes(2);
  });

  it('stops downloading when the job is canceled and leaves no files behind', async () => {
    const fetchOutput = vi.fn<Fetch>(
      (_url, options) =>
        new Promise<SafeFetchResult>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
        }),
    );
    const h = harness({
      fetchOutput,
      provider: providerReturning([{ kind: 'image', url: 'https://cdn.example/slow.png' }]),
    });
    const job = h.enqueue({ cost: 3 });
    const finished = h.runner.tick();
    await h.clock.advance(5000);
    markCanceled(h.db, h.user.id, job.id);
    await h.clock.advance(11_000);
    await finished;

    expect(h.row(job.id).status).toBe('canceled');
    expect(stored(h, job.id)).toHaveLength(0);
    expect(h.storage.objects.size).toBe(0);
    expect(h.balance()).toBe(50);
  });
});

describe('with the real SSRF-safe fetch', () => {
  // The resolver is stubbed, so nothing here can reach the network or a real DNS server.
  function blocked(url: string, address = '10.0.0.5') {
    return async () => {
      setSsrfResolverForTests(async () => [{ address, family: 4 }]);
      const request = vi.spyOn(https, 'request');
      const plain = vi.spyOn(http, 'request');
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const h = harness({ provider: providerReturning([{ kind: 'image', url }]) });
      const job = h.enqueue({ cost: 2 });
      await h.clock.runUntil(h.runner.tick());

      expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
      expect(h.balance()).toBe(50);
      expect(h.storage.objects.size).toBe(0);
      expect(request).not.toHaveBeenCalled();
      expect(plain).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    };
  }

  it(
    'refuses a provider url that resolves to a private address',
    blocked('https://innocent.example/a.png'),
  );
  it('refuses a url pointing at loopback', blocked('https://localhost/a.png'));
  it('refuses the cloud metadata address', blocked('http://169.254.169.254/latest/meta-data/'));
  it('refuses a plain http url', blocked('http://cdn.example/a.png', '93.184.216.34'));
  it('refuses file urls', blocked('file:///etc/passwd'));
  it(
    'refuses urls with credentials',
    blocked('https://user:secret@cdn.example/a.png', '93.184.216.34'),
  );
  it('refuses garbage that is not a url', blocked('not a url at all'));
});
