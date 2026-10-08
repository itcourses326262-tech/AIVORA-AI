import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import { createLocalStorage } from '@/server/storage/local';
import { RangeNotSatisfiableError, type StorageDriver } from '@/server/storage/types';
import { streamToBytes } from '../../helpers/fakes';

let sandbox: string;
let root: string;
let outside: string;
let storage: StorageDriver;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'aivore-local-storage-'));
  root = join(sandbox, 'media');
  outside = join(sandbox, 'outside');
  mkdirSync(outside);
  storage = createLocalStorage(root);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const KEY = 'u/usr_a/uploads/ast_one.png';

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

function allFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true, recursive: true }).map((entry) =>
    join(entry.parentPath, entry.name),
  );
}

describe('put / get / head / delete', () => {
  it('stores bytes and reads them back with size and mime type', async () => {
    const result = await storage.put(KEY, bytesOf('hello'), { mimeType: 'image/png' });
    expect(result).toEqual({ bytes: 5 });

    const read = await storage.get(KEY);
    expect(read.size).toBe(5);
    expect(read.mimeType).toBe('image/png');
    expect(read.range).toBeUndefined();
    expect(textOf(await streamToBytes(read.stream))).toBe('hello');
    expect(await storage.head(KEY)).toEqual({ size: 5, mimeType: 'image/png' });
  });

  it('keeps arbitrary bytes intact, including a large object', async () => {
    const data = new Uint8Array(3 * 1024 * 1024 + 17);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 31 + 7) & 0xff;
    await storage.put('u/usr_a/gen_1/ast_big.mp4', data, { mimeType: 'video/mp4' });
    const read = await storage.get('u/usr_a/gen_1/ast_big.mp4');
    expect(Buffer.from(await streamToBytes(read.stream)).equals(Buffer.from(data))).toBe(true);
  });

  it('stores a Node stream and reports the byte count', async () => {
    const stream = Readable.from([bytesOf('abc'), bytesOf('defg')]);
    const result = await storage.put(KEY, stream, { mimeType: 'image/webp' });
    expect(result.bytes).toBe(7);
    expect(textOf(await streamToBytes((await storage.get(KEY)).stream))).toBe('abcdefg');
  });

  it('stores a zero-byte object', async () => {
    await storage.put(KEY, new Uint8Array(0), { mimeType: 'image/png' });
    const read = await storage.get(KEY);
    expect(read.size).toBe(0);
    expect((await streamToBytes(read.stream)).byteLength).toBe(0);
    expect(await rejection(storage.get(KEY, { start: 0 }))).toBeInstanceOf(
      RangeNotSatisfiableError,
    );
  });

  it('replaces an existing object and its mime type', async () => {
    await storage.put(KEY, bytesOf('first'), { mimeType: 'image/png' });
    await storage.put(KEY, bytesOf('second!'), { mimeType: 'image/webp' });
    expect(await storage.head(KEY)).toEqual({ size: 7, mimeType: 'image/webp' });
    expect(textOf(await streamToBytes((await storage.get(KEY)).stream))).toBe('second!');
  });

  it('reports a missing object as not_found, null and a no-op delete', async () => {
    const error = await rejection(storage.get('u/usr_a/uploads/missing.png'));
    expect(isAppError(error) && error.code).toBe('not_found');
    expect(await storage.head('u/usr_a/uploads/missing.png')).toBeNull();
    await expect(storage.delete('u/usr_a/uploads/missing.png')).resolves.toBeUndefined();
    // Even the very first call, before the root directory exists, must work.
    const fresh = createLocalStorage(join(sandbox, 'never-created'));
    expect(await fresh.head(KEY)).toBeNull();
    await expect(fresh.delete(KEY)).resolves.toBeUndefined();
    expect(isAppError(await rejection(fresh.get(KEY)))).toBe(true);
    expect(existsSync(join(sandbox, 'never-created'))).toBe(false);
  });

  it('deletes the object and its sidecar, and delete is idempotent', async () => {
    await storage.put(KEY, bytesOf('x'), { mimeType: 'image/png' });
    await storage.delete(KEY);
    await storage.delete(KEY);
    expect(await storage.head(KEY)).toBeNull();
    expect(readdirSync(join(root, 'u/usr_a/uploads'))).toEqual([]);
  });

  it('falls back to application/octet-stream when the sidecar is gone or unreadable', async () => {
    await storage.put(KEY, bytesOf('x'), { mimeType: 'image/png' });
    const sidecar = join(root, 'u/usr_a/uploads/.ast_one.png.meta');
    rmSync(sidecar);
    expect((await storage.head(KEY))?.mimeType).toBe('application/octet-stream');
    writeFileSync(sidecar, 'text/html\n<script>');
    expect((await storage.head(KEY))?.mimeType).toBe('application/octet-stream');
  });

  it('refuses a malformed mime type', async () => {
    for (const mimeType of ['', 'png', 'text/html\r\nx: y', 'a/b c', `image/${'x'.repeat(200)}`]) {
      const error = await rejection(storage.put(KEY, bytesOf('x'), { mimeType }));
      expect(isAppError(error) && error.code).toBe('bad_request');
    }
    expect(allFiles(root)).toEqual([]);
  });
});

describe('atomic writes', () => {
  it('leaves no temp file behind after a successful write', async () => {
    await storage.put(KEY, bytesOf('data'), { mimeType: 'image/png' });
    const names = readdirSync(join(root, 'u/usr_a/uploads'));
    expect(names.sort()).toEqual(['.ast_one.png.meta', 'ast_one.png']);
  });

  it('never exposes a partial object and keeps the previous one when a stream fails', async () => {
    await storage.put(KEY, bytesOf('previous'), { mimeType: 'image/png' });
    const failing = new Readable({
      read() {
        this.push(bytesOf('part'));
        this.destroy(new Error('connection reset'));
      },
    });
    await expect(storage.put(KEY, failing, { mimeType: 'image/png' })).rejects.toThrow(
      'connection reset',
    );
    expect(textOf(await streamToBytes((await storage.get(KEY)).stream))).toBe('previous');
    expect(readdirSync(join(root, 'u/usr_a/uploads')).filter((n) => n.startsWith('.tmp-'))).toEqual(
      [],
    );
  });

  it('creates nothing when the first write of a new key fails', async () => {
    const failing = Readable.from(
      (async function* () {
        yield bytesOf('x');
        throw new Error('boom');
      })(),
    );
    await expect(storage.put(KEY, failing, { mimeType: 'image/png' })).rejects.toThrow('boom');
    expect(await storage.head(KEY)).toBeNull();
    expect(readdirSync(join(root, 'u/usr_a/uploads'))).toEqual([]);
  });

  it('survives many concurrent writers, including several to the same new directory and key', async () => {
    const writes = Array.from({ length: 40 }, (_, index) =>
      storage.put(`u/usr_${index % 8}/gen_shared/ast_${index}.png`, bytesOf(`object-${index}`), {
        mimeType: 'image/png',
      }),
    );
    const contested = Array.from({ length: 10 }, (_, index) =>
      storage.put('u/usr_x/gen_y/ast_same.png', bytesOf(`writer-${index}`.padEnd(64, '.')), {
        mimeType: 'image/png',
      }),
    );
    await Promise.all([...writes, ...contested]);
    for (let index = 0; index < 40; index += 1) {
      const read = await storage.get(`u/usr_${index % 8}/gen_shared/ast_${index}.png`);
      expect(textOf(await streamToBytes(read.stream))).toBe(`object-${index}`);
    }
    const winner = textOf(
      await streamToBytes((await storage.get('u/usr_x/gen_y/ast_same.png')).stream),
    );
    expect(winner).toMatch(/^writer-\d\.+$/);
    expect(winner).toHaveLength(64);
  });
});

describe('ranged reads', () => {
  const data = bytesOf('0123456789');
  beforeEach(async () => {
    await storage.put(KEY, data, { mimeType: 'image/png' });
  });

  async function read(range: { start: number; end?: number }) {
    const result = await storage.get(KEY, range);
    return { ...result, text: textOf(await streamToBytes(result.stream)) };
  }

  it.each([
    [{ start: 0, end: 0 }, '0', { start: 0, end: 0 }],
    [{ start: 2, end: 5 }, '2345', { start: 2, end: 5 }],
    [{ start: 0, end: 9 }, '0123456789', { start: 0, end: 9 }],
    [{ start: 4 }, '456789', { start: 4, end: 9 }],
    [{ start: 9 }, '9', { start: 9, end: 9 }],
    [{ start: 7, end: 500 }, '789', { start: 7, end: 9 }],
    [{ start: -3 }, '789', { start: 7, end: 9 }],
    [{ start: -10 }, '0123456789', { start: 0, end: 9 }],
    [{ start: -500 }, '0123456789', { start: 0, end: 9 }],
  ])('%j -> %s', async (requested, expectedText, expectedRange) => {
    const result = await read(requested);
    expect(result.text).toBe(expectedText);
    expect(result.range).toEqual(expectedRange);
    expect(result.size).toBe(10);
    expect(result.mimeType).toBe('image/png');
  });

  it.each([
    [{ start: 10 }],
    [{ start: 11, end: 20 }],
    [{ start: 5, end: 4 }],
    [{ start: -3, end: 5 }],
    [{ start: -0 }],
    [{ start: 1.5 }],
    [{ start: 0, end: 2.5 }],
    [{ start: Number.NaN }],
    [{ start: Number.POSITIVE_INFINITY }],
    [{ start: 0, end: Number.NaN }],
  ])('refuses %j with the 416 error carrying the object size', async (requested) => {
    const error = await rejection(storage.get(KEY, requested));
    expect(error).toBeInstanceOf(RangeNotSatisfiableError);
    expect((error as RangeNotSatisfiableError).status).toBe(416);
    expect((error as RangeNotSatisfiableError).size).toBe(10);
  });

  it('can be cancelled half way without leaking the file descriptor', async () => {
    const fdCount = () => (existsSync('/proc/self/fd') ? readdirSync('/proc/self/fd').length : 0);
    const before = fdCount();
    for (let i = 0; i < 25; i += 1) {
      const result = await storage.get(KEY);
      const reader = result.stream.getReader();
      await reader.read();
      await reader.cancel();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fdCount() - before).toBeLessThan(5);
  });
});

describe('keys', () => {
  const invalidKeys = [
    '',
    '../escape.png',
    'a/../../escape.png',
    'a/../b.png',
    '/etc/passwd',
    '/absolute.png',
    'a//b.png',
    'a/./b.png',
    '.hidden',
    'a/.hidden',
    'a/b/',
    'a\\b.png',
    '..\\escape.png',
    'a/b\0.png',
    'a/b.png\0',
    'a/b.png\n',
    'A/Upper.png',
    'a/b c.png',
    'a/%2e%2e/b.png',
    'a/b?x=1.png',
    'a/ünï.png',
    `a/${'x'.repeat(300)}.png`,
    `${'a/'.repeat(300)}b.png`,
  ];

  it.each(invalidKeys.map((key) => [JSON.stringify(key), key]))(
    'refuses %s on every operation and touches nothing',
    async (_label, key) => {
      const before = allFiles(sandbox);
      for (const operation of [
        () => storage.put(key, bytesOf('x'), { mimeType: 'image/png' }),
        () => storage.get(key),
        () => storage.head(key),
        () => storage.delete(key),
      ]) {
        const error = await rejection(operation());
        expect(isAppError(error) && error.code).toBe('bad_request');
      }
      expect(allFiles(sandbox)).toEqual(before);
    },
  );

  it('refuses non-string keys', async () => {
    for (const key of [undefined, null, 5, {}, ['a']] as unknown as string[]) {
      expect(isAppError(await rejection(storage.head(key)))).toBe(true);
    }
  });

  it('accepts every character the key pattern allows', async () => {
    const key = 'u/usr_a-b/gen_1/ast_9.thumb.webp';
    await storage.put(key, bytesOf('t'), { mimeType: 'image/webp' });
    expect((await storage.head(key))?.size).toBe(1);
  });
});

describe('symlinks', () => {
  beforeEach(async () => {
    await storage.put(KEY, bytesOf('inside'), { mimeType: 'image/png' });
  });

  it('refuses to write through a directory symlink and creates nothing outside', async () => {
    symlinkSync(outside, join(root, 'u/usr_evil'));
    const error = await rejection(
      storage.put('u/usr_evil/uploads/ast_x.png', bytesOf('pwn'), { mimeType: 'image/png' }),
    );
    expect(isAppError(error) && error.code).toBe('bad_request');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses to write through a nested symlinked directory', async () => {
    mkdirSync(join(root, 'u/usr_nested'));
    symlinkSync(outside, join(root, 'u/usr_nested/gen_1'));
    await expect(
      storage.put('u/usr_nested/gen_1/ast_x.png', bytesOf('pwn'), { mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses to read, stat or delete through a directory symlink', async () => {
    writeFileSync(join(outside, 'secret.png'), 'secret');
    symlinkSync(outside, join(root, 'u/usr_evil'));
    const key = 'u/usr_evil/secret.png';
    for (const operation of [
      () => storage.get(key),
      () => storage.head(key),
      () => storage.delete(key),
    ]) {
      expect((await rejection(operation())) as { code: string }).toMatchObject({
        code: 'bad_request',
      });
    }
    expect(readFileSync(join(outside, 'secret.png'), 'utf8')).toBe('secret');
  });

  it('refuses a symlink to a file outside the root', async () => {
    const secret = join(outside, 'secret.png');
    writeFileSync(secret, 'secret');
    symlinkSync(secret, join(root, 'u/usr_a/uploads/ast_link.png'));
    const key = 'u/usr_a/uploads/ast_link.png';
    expect(await rejection(storage.get(key))).toMatchObject({ code: 'bad_request' });
    expect(await rejection(storage.head(key))).toMatchObject({ code: 'bad_request' });
    expect(await rejection(storage.delete(key))).toMatchObject({ code: 'bad_request' });
    expect(
      await rejection(storage.put(key, bytesOf('overwrite'), { mimeType: 'image/png' })),
    ).toMatchObject({ code: 'bad_request' });
    expect(readFileSync(secret, 'utf8')).toBe('secret');
  });

  it('refuses a symlink that stays inside the root as well', async () => {
    symlinkSync(join(root, 'u/usr_a'), join(root, 'u/usr_b'));
    expect(await rejection(storage.get('u/usr_b/uploads/ast_one.png'))).toMatchObject({
      code: 'bad_request',
    });
  });

  it('refuses a dangling symlink and a directory where a file should be', async () => {
    symlinkSync(join(outside, 'nothing-here'), join(root, 'u/usr_a/uploads/ast_dangling.png'));
    expect(await rejection(storage.get('u/usr_a/uploads/ast_dangling.png'))).toMatchObject({
      code: 'bad_request',
    });
    mkdirSync(join(root, 'u/usr_a/uploads/ast_dir.png'));
    expect(await storage.head('u/usr_a/uploads/ast_dir.png')).toBeNull();
    expect(
      await rejection(
        storage.put('u/usr_a/uploads/ast_dir.png', bytesOf('x'), { mimeType: 'image/png' }),
      ),
    ).toMatchObject({ code: 'bad_request' });
  });

  it('works when the configured root is itself a symlink', async () => {
    const real = join(sandbox, 'real-media');
    mkdirSync(real);
    const linked = join(sandbox, 'linked-media');
    symlinkSync(real, linked);
    const viaLink = createLocalStorage(linked);
    await viaLink.put(KEY, bytesOf('ok'), { mimeType: 'image/png' });
    expect(readFileSync(join(real, KEY), 'utf8')).toBe('ok');
    expect(textOf(await streamToBytes((await viaLink.get(KEY)).stream))).toBe('ok');
  });
});
