import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEnv } from '@/server/env';
import { createGcsStorage } from '@/server/storage/gcs';
import { createLocalStorage } from '@/server/storage/local';
import { AppError } from '@/lib/errors';
import type { StorageDriver } from '@/server/storage/types';
import {
  StorageMismatchError,
  adviceFor,
  runStorageCheck,
  scrubSecrets,
  type CheckTarget,
} from '../../scripts/lib/storage-check';
import { FAST, FakeApiError, fakeGcs } from '../server/storage/fake-gcs';
import { startFakeGcsServer, type FakeGcsServer } from '../server/storage/fake-gcs-server';
import {
  keyFragments,
  serviceAccountFixture,
  throwawayPrivateKey,
} from '../server/storage/service-account';

const ROOT = resolve(import.meta.dirname, '../..');

const gcsTarget: CheckTarget = {
  driver: 'gcs',
  where: 'demo-project.firebasestorage.app',
  serviceAccountEmail: 'sa@demo-project.iam.gserviceaccount.com',
};

function gcsOver(fake = fakeGcs()): StorageDriver {
  return createGcsStorage(
    parseEnv({
      NODE_ENV: 'test',
      STORAGE_DRIVER: 'gcs',
      FIREBASE_STORAGE_BUCKET: fake.bucketName,
      FIREBASE_SERVICE_ACCOUNT_FILE: '/never-read.json',
    }),
    { client: fake, ...FAST },
  );
}

async function check(
  storage: StorageDriver,
  target: CheckTarget = gcsTarget,
  secrets: string[] = [],
) {
  const lines: string[] = [];
  const result = await runStorageCheck({
    storage,
    target,
    secrets,
    say: (line) => lines.push(line),
  });
  return { result, lines };
}

describe('runStorageCheck', () => {
  it('passes through the local driver and cleans up after itself', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aivore-check-storage-'));
    try {
      const { result, lines } = await check(createLocalStorage(join(dir, 'media')), {
        driver: 'local',
      });
      expect(result.ok).toBe(true);
      expect(lines.filter((line) => line.includes('... ok'))).toHaveLength(7);
      expect(lines.every((line) => /^[\x20-\x7e]*$/.test(line))).toBe(true);
      // Only the (empty) healthcheck folder is left; no object, no sidecar.
      const left = readdirSync(join(dir, 'media', 'healthcheck'), { recursive: true });
      expect(left).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes through the Google Cloud Storage driver (in-memory client) with timings', async () => {
    const fake = fakeGcs();
    const { result, lines } = await check(gcsOver(fake));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.step)).toEqual([
      'write 4096 random bytes',
      'read the size and type (head)',
      'read it back whole',
      'read bytes 0-9 (range)',
      'read the last 5 bytes (suffix range)',
      'delete it',
      'confirm it is gone',
    ]);
    expect(lines.every((line) => /\(\d+ ms\)$/.test(line))).toBe(true);
    expect(fake.objects.size).toBe(0);
    const keys = fake.calls.map((call) => call.key);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^healthcheck\/[a-z0-9]+-[0-9a-f]{8}\.bin$/);
  });

  it('writes random content each time', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const fake = fakeGcs();
      const spy = gcsOver(fake);
      const original = spy.put.bind(spy);
      spy.put = async (key, body, options) => {
        seen.add(Buffer.from(body as Uint8Array).toString('hex'));
        return original(key, body, options);
      };
      await check(spy);
    }
    expect(seen.size).toBe(3);
  });

  describe('each way it can fail', () => {
    async function failing(op: 'metadata' | 'read' | 'write' | 'delete', error: Error) {
      const fake = fakeGcs();
      fake.failNext(op, error, 10);
      return check(gcsOver(fake));
    }

    it('403: tells which role the service account needs on the bucket', async () => {
      const { result, lines } = await failing(
        'write',
        new FakeApiError(
          403,
          'sa@demo-project.iam.gserviceaccount.com does not have storage.objects.create access',
        ),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('permission');
      expect(result.advice).toContain('Storage Object Admin');
      expect(result.advice).toContain('sa@demo-project.iam.gserviceaccount.com');
      expect(result.advice).toContain('demo-project.firebasestorage.app');
      expect(lines.at(-1)).toContain('FAILED');
    });

    it('bucket missing: names the setting and says to press Get started', async () => {
      const fake = fakeGcs();
      fake.missingBucket = true;
      const { result } = await check(gcsOver(fake));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('bucket');
      expect(result.advice).toContain('FIREBASE_STORAGE_BUCKET');
      expect(result.advice).toContain('Get started');
    });

    it('network: ENOTFOUND', async () => {
      const { result } = await failing(
        'write',
        Object.assign(new Error('getaddrinfo ENOTFOUND storage.googleapis.com'), {
          code: 'ENOTFOUND',
        }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('network');
      expect(result.advice).toContain('internet connection');
      expect(result.advice).toContain('storage.googleapis.com');
    });

    it('invalid_grant: points at the clock and at a new key', async () => {
      const { result } = await failing(
        'write',
        new Error(
          'invalid_grant: Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe.',
        ),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('auth');
      expect(result.advice).toContain('clock');
      expect(result.advice).toContain('setup:firebase');
    });

    it('malformed credentials: says to run the setup again', async () => {
      const { result } = await failing(
        'write',
        Object.assign(new Error('FIREBASE_SERVICE_ACCOUNT_JSON has no "client_email".'), {
          name: 'ServiceAccountError',
        }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('config');
      expect(result.advice).toContain('npm run setup:firebase');
    });

    it('a slow answer: timeout', async () => {
      const { result } = await failing(
        'metadata',
        new Error('Cloud Storage metadata request took longer than 30 s'),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('timeout');
    });

    it('unknown failures are shown by name and message', async () => {
      const { result } = await failing('write', new TypeError('something odd'));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('unknown');
      expect(result.advice).toBe('TypeError: something odd');
    });

    it('stops at the failing step and names it', async () => {
      const { result, lines } = await failing('read', new FakeApiError(403, 'denied'));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.step).toBe('read it back whole');
      expect(lines.filter((line) => line.includes('... ok'))).toHaveLength(2);
    });

    it('removes the test object again when a later step fails', async () => {
      const fake = fakeGcs();
      fake.failNext('read', new FakeApiError(500, 'boom'), 10);
      const { result, lines } = await check(gcsOver(fake));
      expect(result.ok).toBe(false);
      expect(fake.objects.size).toBe(0);
      expect(lines.some((line) => line.startsWith('Removed the test object healthcheck/'))).toBe(
        true,
      );
    });
  });

  describe('a driver that answers wrongly', () => {
    /** Wraps a good driver and tampers with one answer. */
    function tampered(change: (driver: StorageDriver) => Partial<StorageDriver>): StorageDriver {
      const fake = fakeGcs();
      const good = gcsOver(fake);
      return { ...good, ...change(good) };
    }
    const readAll = async (stream: ReadableStream<Uint8Array>) =>
      new Uint8Array(await new Response(stream).arrayBuffer());

    it('different bytes back', async () => {
      const storage = tampered((good) => ({
        async get(key, range) {
          const read = await good.get(key, range);
          const bytes = await readAll(read.stream);
          bytes[0] = (bytes[0] ?? 0) ^ 0xff;
          return { ...read, stream: new Blob([bytes]).stream() };
        },
      }));
      const { result } = await check(storage);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('integrity');
      expect(result.advice).toContain('came back different');
    });

    it('a wrong size, a missing range answer, and an object that survives the delete', async () => {
      const wrongSize = tampered((good) => ({
        async head(key) {
          const info = await good.head(key);
          return info && { ...info, size: info.size + 1 };
        },
      }));
      const noRange = tampered((good) => ({
        async get(key, range) {
          const read = await good.get(key, range);
          return range ? { ...read, range: undefined } : read;
        },
      }));
      const undead = tampered(() => ({ delete: async () => undefined }));
      for (const storage of [wrongSize, noRange, undead]) {
        const { result } = await check(storage);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('integrity');
      }
    });

    it('a suffix range that points to the wrong place', async () => {
      const storage = tampered((good) => ({
        async get(key, range) {
          const read = await good.get(key, range);
          return range && range.start < 0 && read.range
            ? { ...read, range: { start: read.range.start - 1, end: read.range.end } }
            : read;
        },
      }));
      const { result } = await check(storage);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.step).toContain('suffix');
    });
  });

  it('never prints a credential, even when an error carries one', async () => {
    const secret = ['s3', 'cr3t', 'A'.repeat(20)].join('-');
    const fake = fakeGcs();
    const key = throwawayPrivateKey();
    fake.failNext('write', new Error(`bad request with ${secret} and ${key}`), 10);
    const { result, lines } = await check(gcsOver(fake), gcsTarget, [secret]);
    const everything = [...lines, result.ok ? '' : result.advice].join('\n');
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain('PRIVATE KEY');
    for (const fragment of keyFragments(key)) expect(everything).not.toContain(fragment);
  });
});

describe('adviceFor', () => {
  const s3: CheckTarget = { driver: 's3', where: 'media' };
  const local: CheckTarget = { driver: 'local', where: '/data/media' };

  it.each([
    [
      Object.assign(new Error('x'), { $metadata: { httpStatusCode: 403 }, name: 'AccessDenied' }),
      s3,
      'permission',
    ],
    [Object.assign(new Error('no'), { name: 'NoSuchBucket' }), s3, 'bucket'],
    [Object.assign(new Error('x'), { name: 'InvalidAccessKeyId' }), s3, 'auth'],
    [Object.assign(new Error('boom'), { code: 'EACCES' }), local, 'disk'],
    [Object.assign(new Error('boom'), { code: 'ENOSPC' }), local, 'disk'],
    [
      new Error('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) }),
      s3,
      'network',
    ],
    [new Error('The specified bucket does not exist.'), gcsTarget, 'bucket'],
    [Object.assign(new Error('Could not refresh access token'), { code: 401 }), gcsTarget, 'auth'],
    [new Error('socket hang up'), gcsTarget, 'network'],
    [new StorageMismatchError('The size came back different.'), gcsTarget, 'integrity'],
  ])('classifies %s', (error, target, reason) => {
    expect(adviceFor(error, target).reason).toBe(reason);
  });

  it('is ASCII and gives non-empty advice for every class', () => {
    const errors = [
      new FakeApiError(403, 'denied'),
      new Error('The specified bucket does not exist.'),
      new Error('ENOTFOUND'),
      new Error('invalid_grant'),
      new Error('took longer than 30 s'),
      new Error('FIREBASE_SERVICE_ACCOUNT_JSON has no "client_email"'),
      new Error('whatever'),
    ];
    for (const error of errors) {
      const { advice } = adviceFor(error, gcsTarget);
      expect(advice.length).toBeGreaterThan(10);
      expect(advice).toMatch(/^[\x20-\x7e]*$/);
    }
  });
});

describe('scrubSecrets', () => {
  it('removes armoured keys, long tokens and listed literals, and keeps ordinary text', () => {
    const key = throwawayPrivateKey();
    const out = scrubSecrets(
      `before ${key} after ${'a1'.repeat(80)} token-xyz-123 and /data/media/u/1`,
      ['token-xyz-123'],
    );
    // (the key's own final line break stays)
    expect(out).toBe('before [hidden]\n after [hidden] [hidden] and /data/media/u/1');
  });

  it('does not hide long file system paths', () => {
    const path = `/tmp/${'some-long-folder-name/'.repeat(8)}media`;
    expect(scrubSecrets(path)).toBe(path);
  });

  it('ignores very short secrets, which would shred ordinary words', () => {
    expect(scrubSecrets('a b c', ['a'])).toBe('a b c');
  });
});

describe('npm run check:storage (the real script)', () => {
  let server: FakeGcsServer;
  let sandbox: string;
  beforeAll(async () => {
    server = await startFakeGcsServer();
  });
  afterAll(() => server.close());
  beforeEach(() => {
    server.reset();
    server.objects.clear();
    sandbox = mkdtempSync(join(tmpdir(), 'aivore-check-cli-'));
  });
  afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

  function run(extra: Record<string, string>): Promise<{ code: number; out: string }> {
    return new Promise((done, fail) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json'),
        NODE_ENV: 'development',
        LOG_LEVEL: 'error',
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
        ...extra,
      };
      const child = spawn(
        process.execPath,
        [
          '--import',
          join(ROOT, 'node_modules/tsx/dist/loader.mjs'),
          '--conditions=react-server',
          join(ROOT, 'scripts/check-storage.ts'),
        ],
        { cwd: sandbox, env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      child.stdout.on('data', (chunk) => (out += String(chunk)));
      child.stderr.on('data', (chunk) => (out += String(chunk)));
      child.on('error', fail);
      child.on('close', (code) => done({ code: code ?? -1, out }));
    });
  }

  const gcsEnv = (extra: Record<string, string> = {}) => ({
    STORAGE_DRIVER: 'gcs',
    FIREBASE_STORAGE_BUCKET: 'demo-project.firebasestorage.app',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccountFixture()),
    STORAGE_EMULATOR_HOST: server.host,
    ...extra,
  });

  it('works with the local driver', async () => {
    const { code, out } = await run({
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: join(sandbox, 'media'),
    });
    expect(code, out).toBe(0);
    expect(out).toContain('Driver: local');
    expect(out).toContain('OK: storage works');
  }, 60_000);

  it('works with the gcs driver through the real SDK, and says which account it uses', async () => {
    const { code, out } = await run(gcsEnv());
    expect(code, out).toBe(0);
    expect(out).toContain('Driver: gcs (bucket demo-project.firebasestorage.app)');
    expect(out).toContain(
      'Service account: firebase-adminsdk-test@demo-project.iam.gserviceaccount.com',
    );
    expect(out.match(/\.\.\. ok \(\d+ ms\)/g)).toHaveLength(7);
    expect(out).toContain('OK: storage works');
    expect(server.objects.size).toBe(0);
    expect(out).not.toContain('PRIVATE KEY');
  }, 60_000);

  it('403 from the bucket -> exit 1 with the role to grant', async () => {
    server.failUploads(403, 5);
    const { code, out } = await run(gcsEnv());
    expect(code).toBe(1);
    expect(out).toContain('FAILED at "write 4096 random bytes" (permission)');
    expect(out).toContain('Storage Object Admin');
    expect(out).toContain('firebase-adminsdk-test@demo-project.iam.gserviceaccount.com');
  }, 60_000);

  it('a bucket that does not exist -> exit 1 with the setting to fix', async () => {
    const { code, out } = await run(
      gcsEnv({ FIREBASE_STORAGE_BUCKET: 'no-such-project.firebasestorage.app' }),
    );
    expect(code).toBe(1);
    expect(out).toContain('(bucket)');
    expect(out).toContain('FIREBASE_STORAGE_BUCKET');
  }, 60_000);

  it('no network -> exit 1 with network advice', async () => {
    const { code, out } = await run(gcsEnv({ STORAGE_EMULATOR_HOST: 'http://127.0.0.1:1' }));
    expect(code).toBe(1);
    expect(out).toMatch(/\((network|timeout)\)/);
  }, 90_000);

  it('malformed credentials -> exit 1, never the key', async () => {
    const broken = JSON.stringify(serviceAccountFixture({ client_email: undefined }));
    const { code, out } = await run(gcsEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: broken }));
    expect(code).toBe(1);
    expect(out).toContain('(config)');
    expect(out).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
    expect(out).toContain('npm run setup:firebase');
    for (const fragment of keyFragments(throwawayPrivateKey())) expect(out).not.toContain(fragment);
    expect(out).not.toContain('PRIVATE KEY');
  }, 60_000);

  it('a missing service account setting is reported by parseEnv with the name of the setting', async () => {
    const { code, out } = await run(
      gcsEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: '', FIREBASE_SERVICE_ACCOUNT_FILE: '' }),
    );
    expect(code).toBe(1);
    expect(out).toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
  }, 60_000);

  it('ends with a clear message when a thrown AppError is not a storage problem', () => {
    // adviceFor must cope with application errors too.
    expect(adviceFor(AppError.of('bad_request', 'Invalid storage key'), gcsTarget).reason).toBe(
      'unknown',
    );
  });
});
