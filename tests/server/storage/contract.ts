import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import { RangeNotSatisfiableError, type StorageDriver } from '@/server/storage/types';
import { streamToBytes } from '../../helpers/fakes';

export interface ContractSubject {
  driver: StorageDriver;
  teardown?: () => Promise<void> | void;
}

const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const KEY = 'u/usr_a/gen_1/ast_one.png';

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

/**
 * What every StorageDriver promises, written once and run against each driver: round trips,
 * ranges (including suffix ranges and the 416 error), missing objects, idempotent deletes, key and
 * mime validation, and streaming in both directions.
 */
export function describeStorageContract(label: string, create: () => Promise<ContractSubject>) {
  describe(`StorageDriver contract: ${label}`, () => {
    let subject: ContractSubject;
    let storage: StorageDriver;
    beforeEach(async () => {
      subject = await create();
      storage = subject.driver;
    });
    afterEach(async () => {
      await subject.teardown?.();
    });

    describe('put / get / head / delete', () => {
      it('stores bytes and reads them back with size and mime type', async () => {
        expect(await storage.put(KEY, bytesOf('hello'), { mimeType: 'image/png' })).toEqual({
          bytes: 5,
        });
        const read = await storage.get(KEY);
        expect(read.size).toBe(5);
        expect(read.mimeType).toBe('image/png');
        expect(read.range).toBeUndefined();
        expect(textOf(await streamToBytes(read.stream))).toBe('hello');
        expect(await storage.head(KEY)).toEqual({ size: 5, mimeType: 'image/png' });
      });

      it('keeps arbitrary bytes intact, including a multi-megabyte object', async () => {
        const data = new Uint8Array(3 * 1024 * 1024 + 17);
        for (let i = 0; i < data.length; i += 1) data[i] = (i * 31 + 7) & 0xff;
        await storage.put('u/usr_a/gen_1/ast_big.mp4', data, { mimeType: 'video/mp4' });
        const read = await storage.get('u/usr_a/gen_1/ast_big.mp4');
        expect(read.size).toBe(data.length);
        expect(Buffer.from(await streamToBytes(read.stream)).equals(Buffer.from(data))).toBe(true);
      });

      it('stores a Node stream and reports the byte count', async () => {
        const stream = Readable.from([bytesOf('abc'), bytesOf('defg')]);
        expect(await storage.put(KEY, stream, { mimeType: 'image/webp' })).toEqual({ bytes: 7 });
        expect(textOf(await streamToBytes((await storage.get(KEY)).stream))).toBe('abcdefg');
      });

      it('stores a stream of strings too', async () => {
        const result = await storage.put(KEY, Readable.from(['ab', 'cd']), {
          mimeType: 'image/png',
        });
        expect(result.bytes).toBe(4);
        expect(textOf(await streamToBytes((await storage.get(KEY)).stream))).toBe('abcd');
      });

      it('is not confused by a Uint8Array that is a view into a bigger buffer', async () => {
        const backing = bytesOf('xxhelloyy');
        const view = backing.subarray(2, 7);
        expect(await storage.put(KEY, view, { mimeType: 'image/png' })).toEqual({ bytes: 5 });
        expect(textOf(await streamToBytes((await storage.get(KEY)).stream))).toBe('hello');
      });

      it('stores a zero-byte object', async () => {
        expect(await storage.put(KEY, new Uint8Array(0), { mimeType: 'image/png' })).toEqual({
          bytes: 0,
        });
        const read = await storage.get(KEY);
        expect(read.size).toBe(0);
        expect((await streamToBytes(read.stream)).byteLength).toBe(0);
        expect(await storage.head(KEY)).toEqual({ size: 0, mimeType: 'image/png' });
        expect(await storage.put(KEY, Readable.from([]), { mimeType: 'image/png' })).toEqual({
          bytes: 0,
        });
      });

      it('replaces an existing object and its mime type', async () => {
        await storage.put(KEY, bytesOf('one'), { mimeType: 'image/png' });
        await storage.put(KEY, bytesOf('three'), { mimeType: 'image/jpeg' });
        const read = await storage.get(KEY);
        expect(read.mimeType).toBe('image/jpeg');
        expect(textOf(await streamToBytes(read.stream))).toBe('three');
      });

      it('reports a missing object as not_found, null and a no-op delete', async () => {
        const error = await rejection(storage.get('u/usr_a/missing.png'));
        expect(isAppError(error) && error.code).toBe('not_found');
        expect(await storage.head('u/usr_a/missing.png')).toBeNull();
        await expect(storage.delete('u/usr_a/missing.png')).resolves.toBeUndefined();
        const ranged = await rejection(storage.get('u/usr_a/missing.png', { start: 0, end: 3 }));
        expect(isAppError(ranged) && ranged.code).toBe('not_found');
      });

      it('deletes the object, and deleting again is fine', async () => {
        await storage.put(KEY, bytesOf('hello'), { mimeType: 'image/png' });
        await storage.delete(KEY);
        expect(await storage.head(KEY)).toBeNull();
        const error = await rejection(storage.get(KEY));
        expect(isAppError(error) && error.code).toBe('not_found');
        await expect(storage.delete(KEY)).resolves.toBeUndefined();
      });

      it('keeps neighbours with a common prefix apart', async () => {
        await storage.put('u/usr_a/a.png', bytesOf('A'), { mimeType: 'image/png' });
        await storage.put('u/usr_a/a.png.thumb', bytesOf('BB'), { mimeType: 'image/png' });
        await storage.delete('u/usr_a/a.png');
        expect(await storage.head('u/usr_a/a.png')).toBeNull();
        expect(await storage.head('u/usr_a/a.png.thumb')).toEqual({
          size: 2,
          mimeType: 'image/png',
        });
      });

      it('refuses a malformed mime type', async () => {
        for (const mimeType of ['', 'image', 'image/png; charset=x', 'a/b\r\nx: y', 'IMAGE/PNG']) {
          const error = await rejection(storage.put(KEY, bytesOf('x'), { mimeType }));
          expect(isAppError(error) && error.code).toBe('bad_request');
        }
        expect(await storage.head(KEY)).toBeNull();
      });
    });

    describe('ranged reads', () => {
      beforeEach(async () => {
        await storage.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
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
        [{ start: -5 }, '56789', { start: 5, end: 9 }],
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

      it('answers a range of an empty object with the 416 error and size 0', async () => {
        await storage.put('u/usr_a/empty.png', new Uint8Array(0), { mimeType: 'image/png' });
        for (const range of [{ start: 0 }, { start: -5 }, { start: 0, end: 3 }]) {
          const error = await rejection(storage.get('u/usr_a/empty.png', range));
          expect(error).toBeInstanceOf(RangeNotSatisfiableError);
          expect((error as RangeNotSatisfiableError).size).toBe(0);
        }
      });
    });

    describe('streams', () => {
      it('returns a web ReadableStream that can be cancelled half way', async () => {
        const data = new Uint8Array(256 * 1024).fill(7);
        await storage.put(KEY, data, { mimeType: 'video/mp4' });
        for (let i = 0; i < 10; i += 1) {
          const result = await storage.get(KEY);
          expect(result.stream).toBeInstanceOf(ReadableStream);
          const reader = result.stream.getReader();
          const first = await reader.read();
          expect(first.done).toBe(false);
          await reader.cancel();
        }
        // Still fully readable afterwards.
        const again = await storage.get(KEY);
        expect((await streamToBytes(again.stream)).byteLength).toBe(data.length);
      });

      it('reads a ranged slice out of a big object without the rest', async () => {
        const data = new Uint8Array(1024 * 1024);
        for (let i = 0; i < data.length; i += 1) data[i] = i & 0xff;
        await storage.put(KEY, data, { mimeType: 'video/mp4' });
        const result = await storage.get(KEY, { start: 500_000, end: 500_099 });
        const bytes = await streamToBytes(result.stream);
        expect(result.size).toBe(data.length);
        expect(result.range).toEqual({ start: 500_000, end: 500_099 });
        expect(Buffer.from(bytes).equals(Buffer.from(data.subarray(500_000, 500_100)))).toBe(true);
      });

      it('never stores a half-written object when the source stream fails', async () => {
        await storage.put(KEY, bytesOf('original'), { mimeType: 'image/png' });
        const source = Readable.from(
          (async function* () {
            yield bytesOf('partial');
            throw new Error('download dropped');
          })(),
        );
        await expect(storage.put(KEY, source, { mimeType: 'image/png' })).rejects.toThrow(
          'download dropped',
        );
        expect(textOf(await streamToBytes((await storage.get(KEY)).stream))).toBe('original');
        const fresh = await rejection(
          storage.put('u/usr_a/new.png', Readable.from(failAfter('x')), { mimeType: 'image/png' }),
        );
        expect((fresh as Error).message).toBe('download dropped');
        expect(await storage.head('u/usr_a/new.png')).toBeNull();
      });
    });

    describe('keys', () => {
      const BAD = ['../x', '/x', 'a//b', 'A/b', 'a\\b', 'a/.hidden', 'a/./b', 'a/../b', '', 'a b'];

      it('refuses invalid keys in every operation', async () => {
        for (const key of BAD) {
          for (const operation of [
            () => storage.put(key, bytesOf('x'), { mimeType: 'image/png' }),
            () => storage.get(key),
            () => storage.get(key, { start: 0, end: 1 }),
            () => storage.head(key),
            () => storage.delete(key),
          ]) {
            const error = await rejection(operation());
            expect(isAppError(error) && error.code).toBe('bad_request');
          }
        }
      });

      it('refuses non-string keys', async () => {
        for (const key of [undefined, null, 5, {}, ['a']] as unknown as string[]) {
          const error = await rejection(storage.head(key));
          expect(isAppError(error) && error.code).toBe('bad_request');
        }
      });

      it('accepts every character the key pattern allows', async () => {
        const key = 'u/usr_a/gen-1/ast.v2_final.png';
        await storage.put(key, bytesOf('ok'), { mimeType: 'image/png' });
        expect(await storage.head(key)).toEqual({ size: 2, mimeType: 'image/png' });
      });
    });
  });
}

async function* failAfter(first: string) {
  yield bytesOf(first);
  throw new Error('download dropped');
}
