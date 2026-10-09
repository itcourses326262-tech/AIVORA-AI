import { spawn } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStorage } from '@/server/storage/local';
import type { StorageDriver } from '@/server/storage/types';
import {
  DEFAULT_CONCURRENCY,
  contentTypeResolver,
  formatBytes,
  migrateMedia,
  parseMigrateArgs,
  summaryLines,
  type AssetRef,
  type MigrationSummary,
} from '../../scripts/lib/migrate-media';
import { createAsset, createUser } from '../helpers/factories';
import { createTestDb } from '../helpers/db';
import { fakeStorage, streamToBytes } from '../helpers/fakes';
import { startFakeGcsServer, type FakeGcsServer } from '../server/storage/fake-gcs-server';
import { serviceAccountFixture } from '../server/storage/service-account';

const ROOT = resolve(import.meta.dirname, '../..');
const bytesOf = (text: string) => new TextEncoder().encode(text);

let dir: string;
let mediaDir: string;
let local: StorageDriver;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aivore-migrate-media-'));
  mediaDir = join(dir, 'media');
  local = createLocalStorage(mediaDir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const KEYS = {
  png: 'u/usr_a/gen_1/ast_one.png',
  thumb: 'u/usr_a/gen_1/ast_one.thumb.webp',
  mp4: 'u/usr_b/gen_2/ast_two.mp4',
  upload: 'u/usr_b/uploads/ast_three.jpg',
};

async function seedLocal() {
  await local.put(KEYS.png, bytesOf('PNG-BYTES-1234'), { mimeType: 'image/png' });
  await local.put(KEYS.thumb, bytesOf('WEBP'), { mimeType: 'image/webp' });
  await local.put(KEYS.mp4, bytesOf('M'.repeat(5000)), { mimeType: 'video/mp4' });
  await local.put(KEYS.upload, bytesOf('JPG'), { mimeType: 'image/jpeg' });
}

/** A remote that records what happened to it. */
function recordingRemote() {
  const inner = fakeStorage();
  const log = { puts: [] as string[], deletes: [] as string[], mimes: new Map<string, string>() };
  let active = 0;
  let maxActive = 0;
  const hooks = {
    putDelayMs: 0,
    failPut: (_key: string): Error | undefined => undefined,
    wrongByteCount: (_key: string): number | undefined => undefined,
    lieAboutHead: (_key: string): number | undefined => undefined,
  };
  const remote: StorageDriver = {
    ...inner,
    async put(key, body, options) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (hooks.putDelayMs) await new Promise((r) => setTimeout(r, hooks.putDelayMs));
        const failure = hooks.failPut(key);
        if (failure) {
          // Drain like a real driver that failed half way, then fail.
          for await (const _chunk of body as AsyncIterable<unknown>) void _chunk;
          throw failure;
        }
        log.puts.push(key);
        log.mimes.set(key, options.mimeType);
        const result = await inner.put(key, body, options);
        return { bytes: hooks.wrongByteCount(key) ?? result.bytes };
      } finally {
        active -= 1;
      }
    },
    async head(key) {
      const info = await inner.head(key);
      const lie = hooks.lieAboutHead(key);
      return info && lie !== undefined ? { ...info, size: lie } : info;
    },
    async delete(key) {
      log.deletes.push(key);
      await inner.delete(key);
    },
  };
  return { remote, inner, log, hooks, maxActive: () => maxActive };
}

async function migrate(
  remote: StorageDriver,
  options: {
    assets?: AssetRef[];
    apply?: boolean;
    concurrency?: number;
    secrets?: string[];
    source?: StorageDriver;
  } = {},
) {
  const lines: string[] = [];
  const summary = await migrateMedia({
    sourceDir: mediaDir,
    source: options.source ?? local,
    remote,
    assets: options.assets ?? [],
    apply: options.apply ?? true,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    say: (line) => lines.push(line),
    ...(options.secrets ? { secrets: options.secrets } : {}),
  });
  return { summary, lines };
}

describe('dry run', () => {
  it('counts files and bytes and touches nothing', async () => {
    await seedLocal();
    const { remote, log } = recordingRemote();
    const { summary, lines } = await migrate(remote, { apply: false });
    expect(summary.apply).toBe(false);
    expect(summary.total).toEqual({ objects: 4, bytes: 14 + 4 + 5000 + 3 });
    expect(summary.toCopy).toEqual(summary.total);
    expect(summary.alreadyThere.objects).toBe(0);
    expect(log.puts).toEqual([]);
    expect(lines.some((line) => line.startsWith('4 files on this disk'))).toBe(true);
    expect(summaryLines(summary).join('\n')).toContain('DRY RUN');
  });

  it('knows what the remote already has', async () => {
    await seedLocal();
    const { remote, inner } = recordingRemote();
    await inner.put(KEYS.png, bytesOf('PNG-BYTES-1234'), { mimeType: 'image/png' });
    const { summary } = await migrate(remote, { apply: false });
    expect(summary.alreadyThere).toEqual({ objects: 1, bytes: 14 });
    expect(summary.toCopy.objects).toBe(3);
  });
});

describe('apply', () => {
  it('copies every object under the same key with identical bytes', async () => {
    await seedLocal();
    const { remote, inner } = recordingRemote();
    const { summary } = await migrate(remote);
    expect(summary.failed).toEqual([]);
    expect(summary.toCopy.objects).toBe(4);
    expect([...inner.objects.keys()].sort()).toEqual(Object.values(KEYS).sort());
    for (const key of Object.values(KEYS)) {
      const stored = inner.objects.get(key);
      const original = await streamToBytes((await local.get(key)).stream);
      expect(Buffer.from(stored?.bytes ?? []).equals(Buffer.from(original))).toBe(true);
    }
  });

  it('never deletes or changes a local file', async () => {
    await seedLocal();
    const before = new Map(
      await Promise.all(
        Object.values(KEYS).map(
          async (key) => [key, statSync(join(mediaDir, key)).mtimeMs] as const,
        ),
      ),
    );
    const guarded: StorageDriver = {
      ...local,
      delete: async () => {
        throw new Error('the local storage must never be deleted from');
      },
      put: async () => {
        throw new Error('the local storage must never be written to');
      },
    };
    const { remote } = recordingRemote();
    const { summary } = await migrate(remote, { source: guarded });
    expect(summary.failed).toEqual([]);
    for (const [key, mtime] of before) {
      expect(statSync(join(mediaDir, key)).mtimeMs).toBe(mtime);
    }
    expect((await local.head(KEYS.png))?.size).toBe(14);
  });

  describe('content types', () => {
    it('come from the assets table first, thumbnails are webp, then the sidecar, then the extension', async () => {
      await local.put(KEYS.png, bytesOf('a'), { mimeType: 'application/octet-stream' });
      await local.put(KEYS.thumb, bytesOf('b'), { mimeType: 'application/octet-stream' });
      await local.put('u/usr_b/gen_2/clip.mp4', bytesOf('c'), {
        mimeType: 'application/octet-stream',
      });
      await local.put('u/usr_b/gen_2/from-sidecar.bin', bytesOf('d'), { mimeType: 'audio/ogg' });
      await local.put('u/usr_b/gen_2/disagrees.png', bytesOf('e'), { mimeType: 'image/gif' });
      await local.put('u/usr_b/gen_2/mystery.xyz', bytesOf('f'), {
        mimeType: 'application/octet-stream',
      });
      const assets: AssetRef[] = [
        { storageKey: KEYS.png, thumbKey: KEYS.thumb, mimeType: 'image/png' },
        { storageKey: 'u/usr_b/gen_2/disagrees.png', thumbKey: null, mimeType: 'image/png' },
      ];
      const { remote, log } = recordingRemote();
      await migrate(remote, { assets });
      expect(Object.fromEntries(log.mimes)).toEqual({
        [KEYS.png]: 'image/png',
        [KEYS.thumb]: 'image/webp',
        'u/usr_b/gen_2/clip.mp4': 'video/mp4',
        'u/usr_b/gen_2/from-sidecar.bin': 'audio/ogg',
        'u/usr_b/gen_2/disagrees.png': 'image/png',
        'u/usr_b/gen_2/mystery.xyz': 'application/octet-stream',
      });
    });

    it('survives files without a sidecar', async () => {
      mkdirSync(join(mediaDir, 'u', 'usr_a'), { recursive: true });
      writeFileSync(join(mediaDir, 'u', 'usr_a', 'raw.webp'), 'x');
      writeFileSync(join(mediaDir, 'u', 'usr_a', 'raw.unknownext'), 'x');
      const { remote, log } = recordingRemote();
      const { summary } = await migrate(remote);
      expect(summary.failed).toEqual([]);
      expect(Object.fromEntries(log.mimes)).toEqual({
        'u/usr_a/raw.webp': 'image/webp',
        'u/usr_a/raw.unknownext': 'application/octet-stream',
      });
    });

    it('resolver: unusable database types fall through', () => {
      const resolve = contentTypeResolver([
        { storageKey: 'a/x.png', thumbKey: null, mimeType: 'IMAGE/PNG; charset=binary' },
        { storageKey: 'a/y.png', thumbKey: null, mimeType: 'garbage' },
        { storageKey: 'a/z.png', thumbKey: null, mimeType: 'application/octet-stream' },
      ]);
      expect(resolve('a/x.png', undefined)).toBe('image/png');
      expect(resolve('a/y.png', 'image/gif')).toBe('image/gif');
      expect(resolve('a/z.png', undefined)).toBe('image/png');
      expect(resolve('a/none.JPEG', undefined)).toBe('image/jpeg');
    });
  });

  describe('what is not an object', () => {
    it('skips bookkeeping files, links and names the storage layer would refuse', async () => {
      await seedLocal();
      writeFileSync(join(mediaDir, 'u', '.tmp-deadbeef'), 'x');
      writeFileSync(join(mediaDir, 'u', 'usr_a', 'gen_1', '.hidden.png'), 'x');
      writeFileSync(join(mediaDir, 'u', 'usr_a', 'gen_1', 'UPPER.png'), 'x');
      writeFileSync(join(mediaDir, 'u', 'usr_a', 'gen_1', 'has space.png'), 'x');
      if (process.platform !== 'win32') {
        symlinkSync(join(mediaDir, KEYS.png), join(mediaDir, 'u', 'usr_a', 'gen_1', 'link.png'));
      }
      const { remote, inner } = recordingRemote();
      const { summary } = await migrate(remote);
      expect([...inner.objects.keys()].sort()).toEqual(Object.values(KEYS).sort());
      expect(summary.total.objects).toBe(4);
      const ignored = summary.ignored.map((entry) => entry.path).sort();
      expect(ignored).toContain('u/usr_a/gen_1/UPPER.png');
      expect(ignored).toContain('u/usr_a/gen_1/has space.png');
      if (process.platform !== 'win32') expect(ignored).toContain('u/usr_a/gen_1/link.png');
      expect(ignored.some((path) => path.includes('.tmp') || path.includes('.hidden'))).toBe(false);
    });

    it('a media folder that does not exist is an empty migration, not an error', async () => {
      const { remote } = recordingRemote();
      const { summary } = await migrate(remote);
      expect(summary.total.objects).toBe(0);
      expect(summary.failed).toEqual([]);
    });
  });

  describe('resume and idempotence', () => {
    it('a second run copies nothing', async () => {
      await seedLocal();
      const { remote, log } = recordingRemote();
      await migrate(remote);
      const first = log.puts.length;
      const { summary } = await migrate(remote);
      expect(first).toBe(4);
      expect(log.puts.length).toBe(4);
      expect(summary.alreadyThere.objects).toBe(4);
      expect(summary.toCopy.objects).toBe(0);
    });

    it('copies again what is there with the wrong size (an interrupted earlier run)', async () => {
      await seedLocal();
      const { remote, inner, log } = recordingRemote();
      await inner.put(KEYS.mp4, bytesOf('only part of it'), { mimeType: 'video/mp4' });
      const { summary } = await migrate(remote);
      expect(summary.alreadyThere.objects).toBe(0);
      expect(log.puts).toContain(KEYS.mp4);
      expect(inner.objects.get(KEYS.mp4)?.bytes.byteLength).toBe(5000);
    });

    it('after failures, the next run copies exactly what is missing', async () => {
      await seedLocal();
      const { remote, hooks, log } = recordingRemote();
      hooks.failPut = (key) =>
        key === KEYS.mp4 || key === KEYS.upload
          ? new Error(`upload refused for ${key.length}`)
          : undefined;
      const first = await migrate(remote, { concurrency: 1 });
      expect(first.summary.failed.map((f) => f.key).sort()).toEqual([KEYS.mp4, KEYS.upload].sort());
      expect(first.summary.toCopy.objects).toBe(2);
      hooks.failPut = () => undefined;
      log.puts.length = 0;
      const second = await migrate(remote, { concurrency: 1 });
      expect(log.puts.sort()).toEqual([KEYS.mp4, KEYS.upload].sort());
      expect(second.summary.failed).toEqual([]);
      expect(second.summary.alreadyThere.objects).toBe(2);
    });

    it('stops early when every attempt fails the same way, and says how many were not tried', async () => {
      for (let i = 0; i < 20; i += 1) {
        await local.put(`u/usr_a/gen_1/ast_${String(i).padStart(2, '0')}.png`, bytesOf('x'), {
          mimeType: 'image/png',
        });
      }
      const { remote, hooks } = recordingRemote();
      hooks.failPut = () => new Error('invalid credentials');
      const { summary, lines } = await migrate(remote, { concurrency: 1 });
      expect(summary.failed).toHaveLength(5);
      expect(summary.notAttempted).toBe(15);
      expect(lines.join('\n')).toContain('15 files were not tried');
      expect(summaryLines(summary).join('\n')).toContain('not tried');
    });

    it('does not stop for different, unrelated failures', async () => {
      for (let i = 0; i < 8; i += 1) {
        await local.put(`u/usr_a/gen_1/ast_${String(i)}.png`, bytesOf('x'), {
          mimeType: 'image/png',
        });
      }
      const { remote, hooks } = recordingRemote();
      hooks.failPut = (key) => new Error(`specific problem with ${key}`);
      const { summary } = await migrate(remote, { concurrency: 1 });
      expect(summary.failed).toHaveLength(8);
      expect(summary.notAttempted).toBe(0);
    });
  });

  describe('verification', () => {
    it('fails an object when the remote reports a different byte count than the local size', async () => {
      await seedLocal();
      const { remote, hooks } = recordingRemote();
      hooks.wrongByteCount = (key) => (key === KEYS.png ? 3 : undefined);
      const { summary } = await migrate(remote);
      expect(summary.failed.map((f) => f.key)).toEqual([KEYS.png]);
      expect(summary.failed[0]?.message).toContain('sent 3 bytes');
      expect(summary.toCopy.objects).toBe(3);
    });

    it('fails an object when the remote stores a different size than was sent', async () => {
      await seedLocal();
      const { remote, hooks } = recordingRemote();
      hooks.lieAboutHead = (key) => (key === KEYS.thumb ? 1 : undefined);
      // The first head (before the copy) must see nothing; only the check after it lies.
      let copied = false;
      const originalPut = remote.put.bind(remote);
      remote.put = async (key, body, options) => {
        const result = await originalPut(key, body, options);
        copied = true;
        return result;
      };
      const originalHead = remote.head.bind(remote);
      remote.head = async (key) => (copied || key !== KEYS.thumb ? originalHead(key) : null);
      const { summary } = await migrate(remote, { concurrency: 1 });
      expect(summary.failed.map((f) => f.key)).toEqual([KEYS.thumb]);
      expect(summary.failed[0]?.message).toContain('after the copy');
    });
  });

  it('copies in parallel, but never more than the limit', async () => {
    for (let i = 0; i < 12; i += 1) {
      await local.put(`u/usr_a/gen_1/ast_${String(i).padStart(2, '0')}.png`, bytesOf('x'), {
        mimeType: 'image/png',
      });
    }
    for (const limit of [1, 3]) {
      const { remote, hooks, maxActive } = recordingRemote();
      hooks.putDelayMs = 15;
      await migrate(remote, { concurrency: limit });
      expect(maxActive()).toBe(limit);
    }
  });

  it('reports database rows whose file is not on this disk', async () => {
    await seedLocal();
    const { remote } = recordingRemote();
    const { summary } = await migrate(remote, {
      assets: [
        { storageKey: KEYS.png, thumbKey: KEYS.thumb, mimeType: 'image/png' },
        {
          storageKey: 'u/usr_z/gen_9/ast_gone.png',
          thumbKey: 'u/usr_z/gen_9/ast_gone.thumb.webp',
          mimeType: 'image/png',
        },
      ],
    });
    expect(summary.missingLocally).toEqual([
      'u/usr_z/gen_9/ast_gone.png',
      'u/usr_z/gen_9/ast_gone.thumb.webp',
    ]);
    expect(summaryLines(summary).join('\n')).toContain('in the database but not on this disk: 2');
  });

  it('keeps credentials out of failure messages and progress lines', async () => {
    await seedLocal();
    const secret = ['hunter', '2', 'hunter', '2'].join('-');
    const { remote, hooks } = recordingRemote();
    hooks.failPut = () => new Error(`denied for key ${secret}`);
    const { summary, lines } = await migrate(remote, { secrets: [secret] });
    const everything = [...lines, ...summaryLines(summary)].join('\n');
    expect(everything).toContain('denied for key [hidden]');
    expect(everything).not.toContain(secret);
  });

  it('a stream failing in the middle leaves the local file as it was', async () => {
    await seedLocal();
    const { remote, hooks } = recordingRemote();
    hooks.failPut = (key) => (key === KEYS.mp4 ? new Error('connection reset') : undefined);
    await migrate(remote);
    const again = await streamToBytes((await local.get(KEYS.mp4)).stream);
    expect(again.byteLength).toBe(5000);
  });
});

describe('summaryLines', () => {
  const base: MigrationSummary = {
    apply: true,
    total: { objects: 3, bytes: 3_000_000 },
    toCopy: { objects: 2, bytes: 2_000_000 },
    alreadyThere: { objects: 1, bytes: 1_000_000 },
    failed: [],
    notAttempted: 0,
    ignored: [],
    missingLocally: [],
  };

  it('reports the numbers in plain ASCII', () => {
    const text = summaryLines(base).join('\n');
    expect(text).toContain('files on disk      3 (2.9 MB)');
    expect(text).toContain('copied             2');
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
  });

  it('lists failures, at most twenty', () => {
    const failed = Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, message: `m${i}` }));
    const text = summaryLines({ ...base, failed }).join('\n');
    expect(text).toContain('FAILED             25');
    expect(text).toContain('k19: m19');
    expect(text).not.toContain('k20: m20');
    expect(text).toContain('and 5 more');
  });
});

describe('parseMigrateArgs', () => {
  it('has safe defaults: a dry run with four at a time', () => {
    expect(parseMigrateArgs([])).toEqual({ apply: false, concurrency: 4, help: false });
  });

  it.each([
    [['--apply'], { apply: true, concurrency: 4, help: false }],
    [['--concurrency', '8'], { apply: false, concurrency: 8, help: false }],
    [['--concurrency=2', '--apply'], { apply: true, concurrency: 2, help: false }],
    [['--help'], { apply: false, concurrency: 4, help: true }],
    [['-h'], { apply: false, concurrency: 4, help: true }],
  ])('parses %j', (argv, expected) => {
    expect(parseMigrateArgs(argv)).toEqual(expected);
  });

  it.each([
    [['--concurrency']],
    [['--concurrency', '0']],
    [['--concurrency', '33']],
    [['--concurrency', '2.5']],
    [['--concurrency', 'many']],
    [['--concurrency', '-1']],
    [['--concurrency=']],
    [['--apply', '--delete']],
    [['apply']],
  ])('rejects %j', (argv) => {
    expect(parseMigrateArgs(argv)).toHaveProperty('error');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [250 * 1024 * 1024, '250 MB'],
    [3 * 1024 ** 3, '3.0 GB'],
    [5 * 1024 ** 4, '5.0 TB'],
    [5000 * 1024 ** 4, '5000 TB'],
  ])('%d -> %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe('npm run migrate:media (the real script)', () => {
  let server: FakeGcsServer;
  beforeAll(async () => {
    server = await startFakeGcsServer();
  });
  afterAll(() => server.close());
  beforeEach(() => {
    server.reset();
    server.objects.clear();
  });

  function run(
    args: string[],
    extra: Record<string, string>,
  ): Promise<{ code: number; out: string }> {
    return new Promise((done, fail) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json'),
        NODE_ENV: 'development',
        LOG_LEVEL: 'error',
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
        STORAGE_LOCAL_DIR: mediaDir,
        ...extra,
      };
      const child = spawn(
        process.execPath,
        [
          '--import',
          join(ROOT, 'node_modules/tsx/dist/loader.mjs'),
          '--conditions=react-server',
          join(ROOT, 'scripts/migrate-media.ts'),
          ...args,
        ],
        { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      child.stdout.on('data', (chunk) => (out += String(chunk)));
      child.stderr.on('data', (chunk) => (out += String(chunk)));
      child.on('error', fail);
      child.on('close', (code) => done({ code: code ?? -1, out }));
    });
  }

  const gcsEnv = (databasePath: string) => ({
    STORAGE_DRIVER: 'gcs',
    FIREBASE_STORAGE_BUCKET: 'demo-project.firebasestorage.app',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccountFixture()),
    STORAGE_EMULATOR_HOST: server.host,
    DATABASE_PATH: databasePath,
  });

  /** Local files plus a real database whose rows describe them. */
  async function seedWithDatabase() {
    const testDb = createTestDb({ file: true });
    const user = createUser(testDb.db, {});
    const png = createAsset(testDb.db, {
      userId: user.id,
      storageKey: KEYS.png,
      thumbKey: KEYS.thumb,
      mimeType: 'image/png',
    });
    testDb.close();
    await local.put(KEYS.png, bytesOf('PNG-BYTES-1234'), { mimeType: 'application/octet-stream' });
    await local.put(KEYS.thumb, bytesOf('WEBP'), { mimeType: 'application/octet-stream' });
    return { path: testDb.path, png };
  }

  it('refuses to run while STORAGE_DRIVER is local', async () => {
    await seedLocal();
    const { code, out } = await run(['--apply'], { STORAGE_DRIVER: 'local' });
    expect(code).toBe(1);
    expect(out).toContain('nowhere to copy to');
    expect(out).toContain('setup:firebase');
  }, 60_000);

  it('rejects bad flags and prints help', async () => {
    const bad = await run(['--bogus'], { STORAGE_DRIVER: 'local' });
    expect(bad.code).toBe(2);
    expect(bad.out).toContain('usage:');
    const concurrency = await run(['--concurrency', '0'], { STORAGE_DRIVER: 'local' });
    expect(concurrency.code).toBe(2);
    const help = await run(['--help'], { STORAGE_DRIVER: 'local' });
    expect(help.code).toBe(0);
    expect(help.out).toContain('--apply');
  }, 120_000);

  it('dry run by default, then --apply, then a second --apply that copies nothing', async () => {
    const database = await seedWithDatabase();
    await local.put(KEYS.upload, bytesOf('JPG'), { mimeType: 'image/jpeg' });

    const dry = await run([], gcsEnv(database.path));
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toContain('DRY RUN');
    expect(dry.out).toContain('3 files on this disk');
    expect(dry.out).toContain('Run: npm run migrate:media -- --apply');
    expect(server.objects.size).toBe(0);

    const applied = await run(['--apply'], gcsEnv(database.path));
    expect(applied.code, applied.out).toBe(0);
    expect(applied.out).toContain('copied');
    expect([...server.objects.keys()].sort()).toEqual([KEYS.png, KEYS.thumb, KEYS.upload].sort());
    // Types from the database (png), the thumbnail rule (webp) and the local sidecar (jpeg).
    expect(server.objects.get(KEYS.png)?.contentType).toBe('image/png');
    expect(server.objects.get(KEYS.thumb)?.contentType).toBe('image/webp');
    expect(server.objects.get(KEYS.upload)?.contentType).toBe('image/jpeg');
    expect(readFileSync(join(mediaDir, KEYS.png), 'utf8')).toBe('PNG-BYTES-1234');
    expect(statSync(join(mediaDir, KEYS.thumb)).isFile()).toBe(true);

    const again = await run(['--apply', '--concurrency', '2'], gcsEnv(database.path));
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain('already there      3');
    expect(again.out).toContain('copied             0');
  }, 180_000);

  it('works without a database file, with types from the files', async () => {
    await seedLocal();
    const { code, out } = await run(['--apply'], gcsEnv(join(dir, 'no-such.db')));
    expect(code, out).toBe(0);
    expect(out).toContain('No database file found');
    expect(server.objects.get(KEYS.png)?.contentType).toBe('image/png');
  }, 60_000);

  it('exits non-zero with a summary when copies fail, and a later run finishes the job', async () => {
    await seedLocal();
    server.failUploads(403, 100);
    const failed = await run(['--apply', '--concurrency', '1'], gcsEnv(join(dir, 'no-such.db')));
    expect(failed.code).toBe(1);
    expect(failed.out).toContain('FAILED');
    expect(failed.out).toContain('Not everything was copied');
    expect(server.objects.size).toBe(0);
    // Every local file is still there.
    for (const key of Object.values(KEYS))
      expect(statSync(join(mediaDir, key)).isFile()).toBe(true);

    server.reset();
    const fixed = await run(['--apply'], gcsEnv(join(dir, 'no-such.db')));
    expect(fixed.code, fixed.out).toBe(0);
    expect(server.objects.size).toBe(4);
  }, 120_000);

  it('survives an unreadable local file as a failure of that file only', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    await seedLocal();
    chmodSync(join(mediaDir, KEYS.mp4), 0o000);
    const { code, out } = await run(['--apply'], gcsEnv(join(dir, 'no-such.db')));
    expect(code).toBe(1);
    expect(out).toContain(`FAILED ${KEYS.mp4}`);
    expect(server.objects.has(KEYS.png)).toBe(true);
  }, 60_000);
});
