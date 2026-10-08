import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { GenerationDTO, LedgerEntryDTO, UserDTO } from '@/lib/api-types';
import { ProviderError } from '@/server/providers/errors';
import { setProviderOverrides } from '@/server/providers/registry';
import type { GenerationProvider, ProviderOutput } from '@/server/providers/types';
import { setSsrfResolverForTests } from '@/server/security/ssrf';
import { expectConsistentLedger } from '../helpers/credits';
import { TINY_PNG } from '../helpers/fakes';
import { makePng } from '../server/uploads/support';
import { dataOf } from './helpers/api';
import {
  createWorld,
  runToCompletion,
  textToImage,
  textToVideo,
  type Member,
} from './helpers/world';

// A compromised or buggy upstream provider must not be able to make the platform fetch internal
// addresses, store or serve active content, leak its own errors to users or overcharge anyone.
// The provider is replaced by a scripted one; the engine, SSRF guard, storage, media route and
// credits are the real ones.

vi.setConfig({ testTimeout: 60_000 });

const world = createWorld();

function scripted(options: {
  outputs?: ProviderOutput[];
  fail?: unknown;
}): GenerationProvider & { submitted(): number } {
  let submitted = 0;
  return {
    id: 'mock',
    isConfigured: () => true,
    async submit() {
      submitted += 1;
      if (options.fail !== undefined) throw options.fail;
      return { mode: 'sync', outputs: options.outputs ?? [] };
    },
    async poll() {
      return {
        status: 'failed',
        error: new ProviderError('unknown', 'a synchronous provider is never polled'),
      };
    },
    submitted: () => submitted,
  };
}

const balanceOf = async (member: Member) =>
  dataOf(await member.get<UserDTO>('/auth/me')).creditBalance;

async function run(member: Member, body: unknown, provider: GenerationProvider) {
  setProviderOverrides({ mock: provider });
  const queued = dataOf(await member.post<GenerationDTO>('/generations', body), 201);
  // `fetchOutput: undefined` keeps the real SSRF-safe downloader instead of the offline guard.
  const runner = world.runner({ deps: { fetchOutput: undefined } });
  return runToCompletion(member, queued.id, runner);
}

const png = (): ProviderOutput => ({
  kind: 'image',
  bytes: new Uint8Array(TINY_PNG),
  mimeType: 'image/png',
});

describe('result URLs that point somewhere the server must not go', () => {
  const urls = [
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/admin.png',
    'https://[::1]/admin.png',
    'https://localhost/admin.png',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://10.0.0.5:8443/internal.png',
    'https://user:secret@images.example/x.png',
    'https://rebinding.example/x.png', // a public-looking name that resolves to a private address
    'file:///etc/passwd',
    'ftp://images.example/x.png',
  ];

  it.each(urls)(
    '%s is never fetched: the job fails, is refunded and reveals nothing',
    async (url) => {
      // Any name resolves to a private address, so only a bug could ever connect to it.
      setSsrfResolverForTests(async () => [{ address: '10.0.0.5', family: 4 }]);
      const connect = vi.spyOn(net.Socket.prototype, 'connect');
      try {
        const alice = await world.signUp('Alice');
        const done = await run(
          alice,
          textToImage('a lake'),
          scripted({ outputs: [{ kind: 'image', url, mimeType: 'image/png' }] }),
        );

        expect(done).toMatchObject({
          status: 'failed',
          error: { code: 'unavailable' },
          outputs: [],
        });
        expect(JSON.stringify(done)).not.toMatch(
          /169\.254|127\.0|localhost|passwd|10\.0\.0|secret|rebinding/,
        );
        expect(connect).not.toHaveBeenCalled();
        expect(await balanceOf(alice)).toBe(50);
        expect(world.storedFiles()).toEqual([]);
        expectConsistentLedger(world.db, alice.user.id, 0);
      } finally {
        setSsrfResolverForTests(null);
      }
    },
  );
});

describe('result files that are not what they claim to be', () => {
  const html = new TextEncoder().encode('<html><script>alert(document.cookie)</script></html>');
  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  const hostile: Array<[string, unknown, ProviderOutput]> = [
    [
      'an SVG with a script',
      textToImage('a lake'),
      { kind: 'image', bytes: svg, mimeType: 'image/svg+xml' },
    ],
    [
      'HTML labelled as a PNG',
      textToImage('a lake'),
      { kind: 'image', bytes: html, mimeType: 'image/png' },
    ],
    [
      'a PNG cut short',
      textToImage('a lake'),
      { kind: 'image', bytes: new Uint8Array(TINY_PNG).subarray(0, 30), mimeType: 'image/png' },
    ],
    [
      'an error page labelled as a video',
      textToVideo('waves'),
      {
        kind: 'video',
        bytes: new TextEncoder().encode('{"error":"quota exceeded"}'),
        mimeType: 'video/mp4',
      },
    ],
    [
      'an empty file',
      textToImage('a lake'),
      { kind: 'image', bytes: new Uint8Array(), mimeType: 'image/png' },
    ],
  ];

  it.each(hostile)(
    '%s fails the job, refunds it and stores nothing',
    async (_name, body, output) => {
      const alice = await world.signUp('Alice');
      const done = await run(alice, body, scripted({ outputs: [output] }));
      expect(done).toMatchObject({ status: 'failed', error: { code: 'unavailable' }, outputs: [] });
      expect(await balanceOf(alice)).toBe(50);
      expect(world.storedFiles()).toEqual([]);
      expectConsistentLedger(world.db, alice.user.id, 0);
    },
  );

  it('a real picture mislabelled as HTML is served as the picture it is, never as HTML', async () => {
    const alice = await world.signUp('Alice');
    const done = await run(
      alice,
      textToImage('a lake'),
      scripted({
        outputs: [{ kind: 'image', bytes: await makePng(24, 16), mimeType: 'text/html' }],
      }),
    );
    expect(done.status).toBe('succeeded');
    expect(done.outputs[0]).toMatchObject({ mimeType: 'image/png', width: 24, height: 16 });
    const served = await alice.media(done.outputs[0]?.url ?? '');
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('counts and money', () => {
  it('stores only as many files as were paid for', async () => {
    const alice = await world.signUp('Alice');
    const provider = scripted({ outputs: [png(), png(), png()] });
    const done = await run(alice, textToImage('a lake'), provider);
    expect(done.status).toBe('succeeded');
    expect(done.outputs).toHaveLength(1);
    expect(world.storedFiles()).toHaveLength(2);
    expect(await balanceOf(alice)).toBe(49);
  });

  it('refunds the missing share when fewer files arrive than were paid for', async () => {
    const alice = await world.signUp('Alice');
    const done = await run(
      alice,
      textToImage('three moons', { params: { count: 3 } }),
      scripted({ outputs: [png()] }),
    );
    expect(done).toMatchObject({ status: 'succeeded', cost: 3 });
    expect(done.outputs).toHaveLength(1);
    expect(await balanceOf(alice)).toBe(49); // 50 - 3 paid + 2 back for the two missing images
    const ledger = dataOf(await alice.get<LedgerEntryDTO[]>('/account/ledger'));
    expect(ledger.map(({ reason, delta }) => ({ reason, delta }))).toEqual([
      { reason: 'refund', delta: 2 },
      { reason: 'generation', delta: -3 },
      { reason: 'signup_bonus', delta: 50 },
    ]);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });
});

describe('what a provider failure reveals', () => {
  it('shows users only the provider’s safe message, never its internal detail', async () => {
    const alice = await world.signUp('Alice');
    const error = new ProviderError(
      'content_policy',
      'upstream said: key sk-live-ABC123 rejected the prompt',
      {
        userMessage: 'The provider declined this request.',
      },
    );
    const done = await run(alice, textToImage('a lake'), scripted({ fail: error }));
    expect(done).toMatchObject({
      status: 'failed',
      error: { code: 'content_policy', message: 'The provider declined this request.' },
    });
    expect(JSON.stringify(done)).not.toContain('sk-live');
    expect(await balanceOf(alice)).toBe(50);
  });

  it('turns an unexpected crash inside a provider into a generic error and a refund', async () => {
    const alice = await world.signUp('Alice');
    const crash = new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2');
    const done = await run(alice, textToImage('a lake'), scripted({ fail: crash }));
    expect(done).toMatchObject({
      status: 'failed',
      error: { code: 'internal', message: 'The generation failed unexpectedly.' },
    });
    expect(JSON.stringify(done)).not.toMatch(/hunter2|10\.1\.2\.3|ECONNREFUSED/);
    expect(await balanceOf(alice)).toBe(50);
    expect(world.storedFiles()).toEqual([]);
  });

  it('retries a provider that is only briefly unavailable, then succeeds with a single charge', async () => {
    const alice = await world.signUp('Alice');
    let attempts = 0;
    const flaky: GenerationProvider = {
      id: 'mock',
      isConfigured: () => true,
      async submit() {
        attempts += 1;
        if (attempts < 3) throw new ProviderError('unavailable', 'upstream 503');
        return { mode: 'sync', outputs: [png()] };
      },
      async poll() {
        throw new Error('not used');
      },
    };
    const done = await run(alice, textToImage('a lake'), flaky);
    expect(done.status).toBe('succeeded');
    expect(attempts).toBe(3);
    expect(await balanceOf(alice)).toBe(49);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });
});
