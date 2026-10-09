import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@/server/env';
import { createGcsStorage } from '@/server/storage/gcs';
import { startFakeGcsServer } from './fake-gcs-server';
import { serviceAccountFixture, throwawayPrivateKey } from './service-account';

// The real SDK is replaced by a recorder: this file checks how the driver configures it and when it
// loads it, without a network or credentials.
const sdk = vi.hoisted(() => ({
  loads: 0,
  apiEndpoint: 'http://127.0.0.1:1',
  customEndpoint: false,
  size: '4',
  tokens: [] as Array<string | null>,
  bucketsAsked: [] as string[],
  constructed: [] as unknown[],
  failConstructions: 0,
  metadataError: undefined as Error | undefined,
}));

vi.mock('@google-cloud/storage', () => {
  sdk.loads += 1;
  class Storage {
    apiEndpoint = sdk.apiEndpoint;
    customEndpoint = sdk.customEndpoint;
    useAuthWithCustomEndpoint = false;
    authClient = {
      getAccessToken: async () => (sdk.tokens.length > 0 ? sdk.tokens.shift() : 'token-from-sdk'),
    };
    constructor(options: unknown) {
      if (sdk.failConstructions > 0) {
        sdk.failConstructions -= 1;
        throw new Error('sdk refused to start');
      }
      sdk.constructed.push(options);
    }
    bucket(name: string) {
      sdk.bucketsAsked.push(name);
      return {
        file: () => ({
          getMetadata: async () => {
            if (sdk.metadataError) throw sdk.metadataError;
            return [{ size: sdk.size, contentType: 'image/png', generation: '77' }, {}];
          },
        }),
      };
    }
  }
  return { Storage, IdempotencyStrategy: { RetryAlways: 0, RetryConditional: 1, RetryNever: 2 } };
});

const KEY = 'u/usr_a/gen_1/ast_one.png';

function envWithJson() {
  return parseEnv({
    NODE_ENV: 'test',
    STORAGE_DRIVER: 'gcs',
    FIREBASE_STORAGE_BUCKET: 'demo-project.firebasestorage.app',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccountFixture()),
  });
}

beforeEach(() => {
  sdk.constructed.length = 0;
  sdk.bucketsAsked.length = 0;
  sdk.tokens.length = 0;
  sdk.size = '4';
  sdk.customEndpoint = false;
  sdk.failConstructions = 0;
  sdk.metadataError = undefined;
});
afterEach(() => vi.restoreAllMocks());

describe('the SDK client', () => {
  // Must stay the first test of the file: the module is loaded once and then cached.
  it('is not loaded until the first request', async () => {
    expect(sdk.loads).toBe(0);
    const driver = createGcsStorage(envWithJson());
    expect(sdk.loads).toBe(0);
    expect(sdk.constructed).toHaveLength(0);
    expect(await driver.head(KEY)).toEqual({ size: 4, mimeType: 'image/png' });
    expect(sdk.loads).toBe(1);
    expect(sdk.constructed).toHaveLength(1);
    await driver.head(KEY);
    expect(sdk.constructed).toHaveLength(1);
  });

  it('is configured with the service account in memory, never a key file path', async () => {
    await createGcsStorage(envWithJson()).head(KEY);
    const options = sdk.constructed[0] as Record<string, unknown>;
    expect(options.projectId).toBe('demo-project');
    expect(options.credentials).toEqual({
      client_email: 'firebase-adminsdk-test@demo-project.iam.gserviceaccount.com',
      private_key: throwawayPrivateKey(),
      private_key_id: 'k'.repeat(30),
    });
    expect(options).not.toHaveProperty('keyFilename');
    expect(options).not.toHaveProperty('keyFile');
  });

  it('has sensible retry options: bounded, and safe to repeat deletes', async () => {
    await createGcsStorage(envWithJson()).head(KEY);
    const { retryOptions } = sdk.constructed[0] as {
      retryOptions: Record<string, unknown>;
    };
    expect(retryOptions).toMatchObject({
      autoRetry: true,
      maxRetries: 3,
      totalTimeout: 60,
      idempotencyStrategy: 0,
    });
    expect(retryOptions.maxRetryDelay).toBeLessThanOrEqual(10);
  });

  it('asks for the bucket named in the settings', async () => {
    const driver = createGcsStorage(
      parseEnv({
        NODE_ENV: 'test',
        STORAGE_DRIVER: 'gcs',
        FIREBASE_STORAGE_BUCKET: 'gs://other-bucket/',
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccountFixture()),
      }),
    );
    await driver.head(KEY);
    expect(sdk.bucketsAsked).toEqual(['other-bucket']);
  });

  it('tries again after a failed start instead of caching the failure', async () => {
    const driver = createGcsStorage(envWithJson());
    sdk.failConstructions = 1;
    await expect(driver.head(KEY)).rejects.toThrow('sdk refused to start');
    await expect(driver.head(KEY)).resolves.toEqual({ size: 4, mimeType: 'image/png' });
  });

  it('passes the SDK failures through without adding the key to them', async () => {
    sdk.metadataError = Object.assign(new Error('Permission denied'), { code: 403 });
    const error = await createGcsStorage(envWithJson())
      .head(KEY)
      .catch((e: unknown) => e as Error);
    expect(error).toMatchObject({ code: 403, message: 'Permission denied' });
  });
});

describe('media requests made with the SDK credentials', () => {
  async function withServer(
    run: (server: Awaited<ReturnType<typeof startFakeGcsServer>>) => Promise<void>,
  ) {
    const server = await startFakeGcsServer();
    sdk.apiEndpoint = server.host;
    try {
      await run(server);
    } finally {
      sdk.apiEndpoint = 'http://127.0.0.1:1';
      await server.close();
    }
  }

  const readAll = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString();
  };

  function driverFor(bucket: string) {
    return createGcsStorage(
      parseEnv({
        NODE_ENV: 'test',
        STORAGE_DRIVER: 'gcs',
        FIREBASE_STORAGE_BUCKET: bucket,
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccountFixture()),
      }),
      { retryDelayMs: 0 },
    );
  }

  it('sends the access token of the service account as a bearer token', async () => {
    await withServer(async (server) => {
      server.objects.set(KEY, {
        bytes: Buffer.from('hello'),
        contentType: 'image/png',
        generation: 77,
      });
      const driver = driverFor(server.bucket);
      // The SDK mock answers metadata itself; the media request goes to the server.
      const read = await driver.get(KEY, { start: 0, end: 3 }).catch((e: unknown) => e);
      expect(read).toMatchObject({ size: 4 });
      expect(await readAll((read as { stream: ReadableStream<Uint8Array> }).stream)).toBe('hell');
      expect(server.authorizations).toEqual(['Bearer token-from-sdk']);
    });
  });

  it('sends no authorization to a custom endpoint (an emulator)', async () => {
    await withServer(async (server) => {
      server.objects.set(KEY, {
        bytes: Buffer.from('hello'),
        contentType: 'image/png',
        generation: 77,
      });
      sdk.customEndpoint = true;
      const read = await driverFor(server.bucket).get(KEY, { start: 0, end: 3 });
      await readAll(read.stream);
      expect(server.authorizations).toEqual([undefined]);
    });
  });

  it('fails clearly when Google gives no token, and sends nothing', async () => {
    await withServer(async (server) => {
      server.objects.set(KEY, {
        bytes: Buffer.from('hello'),
        contentType: 'image/png',
        generation: 77,
      });
      sdk.tokens.push(null);
      await expect(driverFor(server.bucket).get(KEY, { start: 0, end: 3 })).rejects.toThrow(
        'access token',
      );
      expect(server.requests).toEqual([]);
    });
  });

  it('asks the JSON API for the right object, generation and slice', async () => {
    await withServer(async (server) => {
      server.objects.set('u/usr_a/a b.png', {
        bytes: Buffer.from('0123456789'),
        contentType: 'image/png',
        generation: 77,
      });
      sdk.size = '10';
      const driver = driverFor(server.bucket);
      await driver.get('u/usr_a/a b.png', { start: 2, end: 5 }).catch(() => undefined);
      // (the key above is not a valid storage key: nothing may reach the server for it)
      expect(server.requests).toEqual([]);
      server.objects.set('u/usr_a/ab.png', {
        bytes: Buffer.from('0123456789'),
        contentType: 'image/png',
        generation: 77,
      });
      const result = await driver.get('u/usr_a/ab.png', { start: 2, end: 5 });
      expect(await readAll(result.stream)).toBe('2345');
      expect(server.requests.at(-1)).toBe(
        `GET /storage/v1/b/${server.bucket}/o/u%2Fusr_a%2Fab.png?alt=media&generation=77`,
      );
      expect(server.ranges.at(-1)).toBe('bytes=2-5');
    });
  });
});
