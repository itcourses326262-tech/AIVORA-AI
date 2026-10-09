// OWNER: storage
import 'server-only';
import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { AppError } from '@/lib/errors';
import { assertStorageKey } from './keys';
import { DEFAULT_MIME, assertMimeType, isValidMimeType } from './mime';
import { resolveStorageRange } from './range';
import type { StorageDriver, StorageRange, StorageReadResult, StoredObjectInfo } from './types';

// Not defined on Windows, where the symlink checks below still run.
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

type Body = Uint8Array | NodeJS.ReadableStream;

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

const MISSING = new Set(['ENOENT', 'ENOTDIR']);
const isMissing = (error: unknown) => MISSING.has(errorCode(error) ?? '');

const refuse = () => AppError.of('bad_request', 'Invalid storage key');
const notFound = () => AppError.of('not_found', 'No such object');

/**
 * Stores objects as files under `rootDir`.
 *
 * - Keys pass `assertStorageKey` (lowercase `[a-z0-9/_.-]`, no empty, `.` or `..` segments).
 * - A symlink anywhere on the way to an object (directory or file) is refused, so a link planted
 *   in the media directory can never lead a read, write or delete outside it.
 * - Writes go to a hidden temp file in the destination directory, are fsynced and then renamed
 *   into place, so readers never see a partial object and a crash leaves at most a `.tmp-*` file.
 * - The mime type lives in a hidden sidecar (`.<name>.meta`) next to the object; keys cannot start
 *   a segment with a dot, so sidecars and temp files can never collide with an object.
 */
export function createLocalStorage(rootDir: string): StorageDriver {
  const root = resolve(rootDir);
  let canonicalRoot: string | undefined;

  /** The root with symlinks resolved, or null while it does not exist. */
  async function existingRoot(): Promise<string | null> {
    if (canonicalRoot) return canonicalRoot;
    try {
      canonicalRoot = await realpath(root);
      return canonicalRoot;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async function ensureRoot(): Promise<string> {
    const existing = await existingRoot();
    if (existing) return existing;
    await mkdir(root, { recursive: true });
    const created = await existingRoot();
    if (!created) throw new Error('Storage root disappeared right after it was created');
    return created;
  }

  /** The real directory that holds `key`, or null when it does not exist. */
  async function locate(key: string): Promise<{ dir: string; name: string } | null> {
    assertStorageKey(key);
    const base = await existingRoot();
    if (!base) return null;
    const segments = key.split('/');
    const name = segments.pop() as string;
    // The key is a runtime value under the configured storage directory: nothing there is a source
    // file, so the bundler must not trace the whole project for it (see `next build`'s warning).
    const lexical = join(/*turbopackIgnore: true*/ base, ...segments);
    let real: string;
    try {
      real = await realpath(lexical);
    } catch (error) {
      if (isMissing(error)) return null;
      if (errorCode(error) === 'ELOOP') throw refuse();
      throw error;
    }
    // `lexical` is built from the canonical root and validated segments, so any difference means a
    // component of the path is a symlink.
    if (real !== lexical) throw refuse();
    return { dir: real, name };
  }

  /** Creates the directories of `key` one level at a time, refusing links and races alike. */
  async function prepareDirectory(key: string): Promise<{ dir: string; name: string }> {
    assertStorageKey(key);
    const segments = key.split('/');
    const name = segments.pop() as string;
    let current = await ensureRoot();
    for (const segment of segments) {
      const next = join(/*turbopackIgnore: true*/ current, segment);
      let info = await lstat(next).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (!info) {
        try {
          await mkdir(next);
        } catch (error) {
          // Another request created it first: fine, as long as it is a real directory.
          if (errorCode(error) !== 'EEXIST') throw error;
        }
        info = await lstat(next);
      }
      if (info.isSymbolicLink() || !info.isDirectory()) throw refuse();
      current = next;
    }
    return { dir: current, name };
  }

  const sidecarPath = (dir: string, name: string) => join(dir, `.${name}.meta`);

  async function readMimeType(dir: string, name: string): Promise<string> {
    try {
      const raw = await readFile(sidecarPath(dir, name), {
        encoding: 'utf8',
        flag: fsConstants.O_RDONLY | O_NOFOLLOW,
      });
      const mime = raw.trim();
      if (isValidMimeType(mime)) return mime;
    } catch {
      // No sidecar (or an unreadable one): the object is still served, as opaque bytes.
    }
    return DEFAULT_MIME;
  }

  async function writeAtomically(
    path: string,
    write: (handle: FileHandle) => Promise<void>,
  ): Promise<void> {
    const temp = join(dirname(path), `.tmp-${randomBytes(8).toString('hex')}`);
    let handle: FileHandle | undefined;
    try {
      handle = await open(temp, 'wx');
      await write(handle);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temp, path);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function writeBody(handle: FileHandle, body: Body): Promise<number> {
    if (body instanceof Uint8Array) {
      await handle.writeFile(body);
      return body.byteLength;
    }
    // One awaited write per chunk keeps memory flat and applies backpressure to the source.
    let written = 0;
    for await (const chunk of body) {
      const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      await handle.writeFile(data);
      written += data.byteLength;
    }
    return written;
  }

  async function removeIfPresent(path: string): Promise<void> {
    try {
      await rm(path, { force: true });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  return {
    async put(key, body, { mimeType }) {
      assertMimeType(mimeType);
      const { dir, name } = await prepareDirectory(key);
      const target = join(/*turbopackIgnore: true*/ dir, name);
      const existing = await lstat(target).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      // A link or directory where the object should go means the store was tampered with.
      if (existing && !existing.isFile()) throw refuse();

      let bytes = 0;
      await writeAtomically(target, async (handle) => {
        bytes = await writeBody(handle, body);
      });
      await writeAtomically(sidecarPath(dir, name), async (handle) => {
        await handle.writeFile(mimeType, 'utf8');
      });
      return { bytes };
    },

    async get(key, range?: StorageRange): Promise<StorageReadResult> {
      const located = await locate(key);
      if (!located) throw notFound();
      let handle: FileHandle;
      try {
        handle = await open(join(located.dir, located.name), fsConstants.O_RDONLY | O_NOFOLLOW);
      } catch (error) {
        if (isMissing(error)) throw notFound();
        if (errorCode(error) === 'ELOOP') throw refuse();
        throw error;
      }
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw notFound();
        const size = info.size;
        const mimeType = await readMimeType(located.dir, located.name);
        const slice = range ? resolveStorageRange(range, size) : undefined;
        if (size === 0) {
          await handle.close();
          return { stream: new Blob([]).stream(), size, mimeType };
        }
        const bounds = slice ?? { start: 0, end: size - 1 };
        // The handle is closed by the stream when it ends, errors or is cancelled.
        const stream = Readable.toWeb(
          handle.createReadStream({ start: bounds.start, end: bounds.end, autoClose: true }),
        ) as ReadableStream<Uint8Array>;
        return { stream, size, mimeType, ...(slice ? { range: slice } : {}) };
      } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
      }
    },

    async head(key): Promise<StoredObjectInfo | null> {
      const located = await locate(key);
      if (!located) return null;
      const path = join(located.dir, located.name);
      const info = await lstat(path).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (!info) return null;
      if (info.isSymbolicLink()) throw refuse();
      if (!info.isFile()) return null;
      return { size: info.size, mimeType: await readMimeType(located.dir, located.name) };
    },

    async delete(key) {
      const located = await locate(key);
      if (!located) return;
      const path = join(located.dir, located.name);
      const info = await lstat(path).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (!info) return;
      if (!info.isFile()) throw refuse();
      await removeIfPresent(path);
      await removeIfPresent(sidecarPath(located.dir, located.name));
    },
  };
}
