import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from '@/server/env';
import { createGcsStorage } from '@/server/storage/gcs';
import { createLocalStorage } from '@/server/storage/local';
import { describeStorageContract } from './contract';
import { FAST, fakeGcs } from './fake-gcs';

describeStorageContract('local disk', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'aivore-contract-'));
  return {
    driver: createLocalStorage(join(sandbox, 'media')),
    teardown: () => rmSync(sandbox, { recursive: true, force: true }),
  };
});

describeStorageContract('Google Cloud Storage (in-memory fake client)', async () => {
  const fake = fakeGcs();
  const env = parseEnv({
    NODE_ENV: 'test',
    STORAGE_DRIVER: 'gcs',
    FIREBASE_STORAGE_BUCKET: fake.bucketName,
    FIREBASE_SERVICE_ACCOUNT_FILE: '/not-read-with-an-injected-client.json',
  });
  return { driver: createGcsStorage(env, { client: fake, ...FAST }) };
});
