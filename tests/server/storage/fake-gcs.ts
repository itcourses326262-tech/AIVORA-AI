import { Writable } from 'node:stream';
import type {
  GcsBucket,
  GcsClient,
  GcsFile,
  GcsFileMetadata,
  GcsStorageOptions,
} from '@/server/storage/gcs';

/** What `@google-cloud/storage` throws for a failed call: an Error whose `code` is the HTTP status. */
export class FakeApiError extends Error {
  constructor(
    readonly code: number | string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type FakeOperation = 'metadata' | 'read' | 'write' | 'delete';

export interface FakeObject {
  bytes: Uint8Array;
  contentType: string | undefined;
  generation: number;
}

export interface FakeCall {
  op: FakeOperation;
  key: string;
  generation?: string | number | undefined;
  options?: unknown;
}

export interface FakeGcs extends GcsClient {
  readonly bucketName: string;
  readonly objects: Map<string, FakeObject>;
  readonly calls: FakeCall[];
  /** Names the buckets the driver asked for. */
  readonly bucketsAsked: string[];
  /** Fails the next `times` calls of one kind. A `write` fails once the upload is finished. */
  failNext(op: FakeOperation, error: Error, times?: number): void;
  /** Makes every call fail the way Google answers for a bucket that does not exist. */
  missingBucket: boolean;
  /** Delay (ms) the sink takes per chunk, to make backpressure visible. */
  writeDelayMs: number;
  /** Chunks the sink has received so far, across uploads. */
  chunksReceived: number;
  /** Runs once, right after the next metadata answer: lets a test change the object under the driver. */
  afterMetadata: (() => void) | undefined;
}

const CHUNK = 7;

/** An in-memory stand-in for the part of the SDK the driver uses, with Google's observable rules. */
export function fakeGcs(bucketName = 'aivore-test.firebasestorage.app'): FakeGcs {
  const objects = new Map<string, FakeObject>();
  const calls: FakeCall[] = [];
  const bucketsAsked: string[] = [];
  const failures: Array<{ op: FakeOperation; error: Error; times: number }> = [];
  let generation = 1000;

  const state: FakeGcs = {
    bucketName,
    objects,
    calls,
    bucketsAsked,
    missingBucket: false,
    writeDelayMs: 0,
    chunksReceived: 0,
    afterMetadata: undefined,
    failNext(op, error, times = 1) {
      failures.push({ op, error, times });
    },
    bucket(name): GcsBucket {
      bucketsAsked.push(name);
      return { file: (key) => file(key) };
    },
  };

  function takeFailure(op: FakeOperation): Error | undefined {
    if (state.missingBucket) return new FakeApiError(404, 'The specified bucket does not exist.');
    const found = failures.find((entry) => entry.op === op && entry.times > 0);
    if (!found) return undefined;
    found.times -= 1;
    return found.error;
  }

  /** The object a call may see: a pinned generation that is no longer current is gone. */
  function visible(key: string, pinned: string | number | undefined): FakeObject | undefined {
    const object = objects.get(key);
    if (!object) return undefined;
    if (pinned !== undefined && String(object.generation) !== String(pinned)) return undefined;
    return object;
  }

  const noSuchObject = (key: string) =>
    new FakeApiError(404, `No such object: ${bucketName}/${key}`);

  function file(key: string): GcsFile {
    return {
      async getMetadata() {
        calls.push({ op: 'metadata', key });
        const failure = takeFailure('metadata');
        if (failure) throw failure;
        const object = visible(key, undefined);
        if (!object) throw noSuchObject(key);
        const metadata: GcsFileMetadata = {
          size: String(object.bytes.byteLength),
          generation: String(object.generation),
          ...(object.contentType ? { contentType: object.contentType } : {}),
        };
        const hook = state.afterMetadata;
        state.afterMetadata = undefined;
        hook?.();
        return [metadata, {}];
      },

      async openRead(options) {
        calls.push({ op: 'read', key, generation: options.generation, options });
        const failure = takeFailure('read');
        if (failure) throw failure;
        const object = visible(key, options.generation);
        if (!object) throw noSuchObject(key);
        const size = object.bytes.byteLength;
        const ranged = options.start !== undefined && options.end !== undefined;
        const start = options.start ?? 0;
        if (ranged && start >= size) {
          throw new FakeApiError(416, 'Requested range not satisfiable');
        }
        const end = ranged ? Math.min(options.end ?? size - 1, size - 1) : size - 1;
        const data = Buffer.from(object.bytes.subarray(start, end + 1));
        let at = 0;
        // Several small chunks, like a network: and a cancel really stops the stream.
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (at >= data.byteLength) return controller.close();
            controller.enqueue(new Uint8Array(data.subarray(at, at + CHUNK)));
            at += CHUNK;
          },
        });
      },

      createWriteStream(options) {
        calls.push({ op: 'write', key, options });
        const received: Buffer[] = [];
        return new Writable({
          write(chunk: Buffer, _encoding, done) {
            state.chunksReceived += 1;
            received.push(Buffer.from(chunk));
            if (state.writeDelayMs > 0) setTimeout(done, state.writeDelayMs);
            else setImmediate(done);
          },
          final(done) {
            const failure = takeFailure('write');
            if (failure) return done(failure);
            generation += 1;
            // Visible only once the whole upload is in, like a real (non-resumable) upload.
            objects.set(key, {
              bytes: new Uint8Array(Buffer.concat(received)),
              contentType: options?.contentType,
              generation,
            });
            return done();
          },
        });
      },

      async delete() {
        calls.push({ op: 'delete', key });
        const failure = takeFailure('delete');
        if (failure) throw failure;
        if (!objects.delete(key)) throw noSuchObject(key);
        return [{}];
      },
    };
  }

  return state;
}

/** Options that make retries and timeouts instant in tests. */
export const FAST: GcsStorageOptions = {
  retryDelayMs: 0,
  requestTimeoutMs: 2_000,
  uploadTimeoutMs: 5_000,
};
