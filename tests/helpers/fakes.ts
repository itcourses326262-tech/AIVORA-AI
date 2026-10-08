import { vi, type Mock } from 'vitest';
import type { ProviderId } from '@/lib/catalog/types';
import { AppError } from '@/lib/errors';
import { getEnv, type Env } from '@/server/env';
import { createLogger } from '@/server/logger';
import type {
  GenerationProvider,
  PollResult,
  ProviderContext,
  ProviderInput,
  ProviderOutput,
  SubmitResult,
} from '@/server/providers/types';
import {
  STORAGE_KEY_PATTERN,
  type StorageDriver,
  type StorageRange,
  type StorageReadResult,
} from '@/server/storage/types';

/** A valid 1x1 PNG. */
export const TINY_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** A valid 1x1 GIF. */
export const TINY_GIF = Uint8Array.from(
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
);

/** Reads a web stream to the end. */
export async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function bodyToBytes(body: Uint8Array | NodeJS.ReadableStream): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return Uint8Array.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export interface FakeStorage extends StorageDriver {
  /** Everything currently stored, by key. */
  readonly objects: Map<string, { bytes: Uint8Array; mimeType: string }>;
}

/**
 * An in-memory {@link StorageDriver} with the same observable rules as the real ones: keys must
 * match `STORAGE_KEY_PATTERN` and contain no `..`, `get` of a missing key is `not_found`, ranges
 * are inclusive, deleting a missing key is fine. `signedUrls: true` adds a `signedUrl` method.
 */
export function fakeStorage(options: { signedUrls?: boolean } = {}): FakeStorage {
  const objects = new Map<string, { bytes: Uint8Array; mimeType: string }>();

  const checkKey = (key: string) => {
    if (!STORAGE_KEY_PATTERN.test(key) || key.includes('..') || key.startsWith('/')) {
      throw AppError.of('bad_request', `Invalid storage key: ${key}`);
    }
  };

  const driver: FakeStorage = {
    objects,
    async put(key, body, { mimeType }) {
      checkKey(key);
      const bytes = await bodyToBytes(body);
      objects.set(key, { bytes, mimeType });
      return { bytes: bytes.byteLength };
    },
    async get(key, range?: StorageRange): Promise<StorageReadResult> {
      checkKey(key);
      const object = objects.get(key);
      if (!object) throw AppError.of('not_found', `No such object: ${key}`);
      const size = object.bytes.byteLength;
      if (!range) {
        return {
          stream: new Blob([new Uint8Array(object.bytes)]).stream(),
          size,
          mimeType: object.mimeType,
        };
      }
      const end = Math.min(range.end ?? size - 1, size - 1);
      if (range.start < 0 || range.start > end) {
        throw AppError.of('bad_request', 'Range not satisfiable');
      }
      return {
        stream: new Blob([new Uint8Array(object.bytes.slice(range.start, end + 1))]).stream(),
        size,
        mimeType: object.mimeType,
        range: { start: range.start, end },
      };
    },
    async head(key) {
      checkKey(key);
      const object = objects.get(key);
      return object ? { size: object.bytes.byteLength, mimeType: object.mimeType } : null;
    },
    async delete(key) {
      checkKey(key);
      objects.delete(key);
    },
  };
  if (options.signedUrls) {
    driver.signedUrl = async (key, ttlSec) => {
      checkKey(key);
      return objects.has(key) ? `https://storage.test/${key}?ttl=${ttlSec}` : null;
    };
  }
  return driver;
}

export interface FakeProviderOptions {
  /** Defaults to `mock`. */
  id?: ProviderId;
  /** Defaults to true. */
  configured?: boolean | ((env: Env) => boolean);
  /** Defaults to a synchronous result with `params.count` tiny outputs of the model's kind. */
  submit?: (input: ProviderInput, ctx: ProviderContext) => SubmitResult | Promise<SubmitResult>;
  /** Defaults to `succeeded` with one tiny output. */
  poll?: (
    providerJobId: string,
    input: ProviderInput,
    ctx: ProviderContext,
    meta?: Record<string, unknown>,
  ) => PollResult | Promise<PollResult>;
  /** When given, the provider supports `cancel`. */
  cancel?: (
    providerJobId: string,
    ctx: ProviderContext,
    meta?: Record<string, unknown>,
  ) => void | Promise<void>;
}

export interface FakeProvider extends GenerationProvider {
  isConfigured: Mock<GenerationProvider['isConfigured']>;
  submit: Mock<GenerationProvider['submit']>;
  poll: Mock<GenerationProvider['poll']>;
}

/** One tiny, decodable output of the kind the model produces. */
export function tinyOutput(kind: ProviderOutput['kind']): ProviderOutput {
  return kind === 'image'
    ? { kind, bytes: TINY_PNG, mimeType: 'image/png', width: 1, height: 1 }
    : { kind, bytes: TINY_GIF, mimeType: 'image/gif', width: 1, height: 1, durationMs: 1000 };
}

/**
 * A scriptable {@link GenerationProvider} whose methods are `vi.fn` mocks, for engine, route and
 * registry tests (`setProviderOverrides({ mock: fakeProvider() })`). Create one per test.
 */
export function fakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const configured = options.configured ?? true;
  const submitWith =
    options.submit ??
    ((input: ProviderInput): SubmitResult => ({
      mode: 'sync',
      outputs: Array.from({ length: input.params.count }, () => tinyOutput(input.model.kind)),
    }));
  const pollWith =
    options.poll ??
    ((_jobId: string, input: ProviderInput): PollResult => ({
      status: 'succeeded',
      outputs: [tinyOutput(input.model.kind)],
    }));
  const provider: FakeProvider = {
    id: options.id ?? 'mock',
    isConfigured: vi.fn<GenerationProvider['isConfigured']>((env) =>
      typeof configured === 'function' ? configured(env) : configured,
    ),
    submit: vi.fn<GenerationProvider['submit']>(async (input, ctx) => submitWith(input, ctx)),
    poll: vi.fn<GenerationProvider['poll']>(async (jobId, input, ctx, meta) =>
      pollWith(jobId, input, ctx, meta),
    ),
  };
  const { cancel } = options;
  if (cancel) {
    provider.cancel = vi.fn<NonNullable<GenerationProvider['cancel']>>(async (jobId, ctx, meta) => {
      await cancel(jobId, ctx, meta);
    });
  }
  return provider;
}

/**
 * A {@link ProviderContext} for adapter tests: a signal you can abort, the test env, a silent
 * logger and a `fetch` that fails loudly unless you pass one (`vi.fn` returning `Response`s).
 */
export function fakeProviderContext(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return {
    signal: new AbortController().signal,
    env: getEnv(),
    fetch: () => Promise.reject(new Error('fakeProviderContext: no fetch stub was provided')),
    log: createLogger({ level: 'silent' }),
    ...overrides,
  };
}
