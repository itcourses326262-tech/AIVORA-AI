import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvError, resetEnvForTests } from '@/server/env';
import { setStorageOverride, storageProblem } from '@/server/storage';
import { fakeStorage } from '../../helpers/fakes';
import { keyFragments, serviceAccountFixture, throwawayPrivateKey } from './service-account';

// The real drivers and the real key checks, no mocks: this is what decides whether the site starts.
const GLOBAL_KEY = Symbol.for('aivore.storage');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aivore-storage-problem-'));
  (globalThis as Record<symbol, unknown>)[GLOBAL_KEY] = undefined;
  vi.stubEnv('STORAGE_DRIVER', 'gcs');
  vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo-project.firebasestorage.app');
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '');
  resetEnvForTests();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  setStorageOverride(null);
  (globalThis as Record<symbol, unknown>)[GLOBAL_KEY] = undefined;
  vi.unstubAllEnvs();
  resetEnvForTests();
});

function keyFile(contents: string = JSON.stringify(serviceAccountFixture())): string {
  const file = join(dir, 'secret-folder-name.json');
  writeFileSync(file, contents);
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', file);
  resetEnvForTests();
  return file;
}

describe('storageProblem', () => {
  it('is null for the local disk, which cannot fail to start', () => {
    vi.stubEnv('STORAGE_DRIVER', 'local');
    resetEnvForTests();
    expect(storageProblem()).toBeNull();
  });

  it('is null for a usable key, without any network', () => {
    keyFile();
    expect(storageProblem()).toBeNull();
  });

  it('names the setting and the driver in one line when the key file is missing', () => {
    const file = keyFile();
    rmSync(file);
    const problem = storageProblem() as string;
    expect(problem).toContain('STORAGE_DRIVER=gcs');
    expect(problem).toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
    expect(problem).toContain('ENOENT');
    expect(problem).not.toContain('\n');
    // The path is not part of it: this line goes to logs and to the health probe's log.
    expect(problem).not.toContain('secret-folder-name');
  });

  // Root reads anything, and Windows has no POSIX modes.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'names the setting when the file exists but the server may not read it',
    () => {
      chmodSync(keyFile(), 0o000);
      expect(storageProblem()).toMatch(/FIREBASE_SERVICE_ACCOUNT_FILE.*EACCES/);
    },
  );

  it('says what DEPLOYMENT.md shows operators it says', () => {
    const missing = join(dir, 'gone.json');
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', missing);
    resetEnvForTests();
    const problem = storageProblem() as string;
    const documented = readFileSync(
      join(import.meta.dirname, '../../../docs/DEPLOYMENT.md'),
      'utf8',
    );
    expect(documented).toContain(problem);
  });

  it('names the setting for a file that is not a key, and never quotes it', () => {
    keyFile(JSON.stringify(serviceAccountFixture({ private_key: 'nonsense-private-text' })));
    const problem = storageProblem() as string;
    expect(problem).toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
    expect(problem).not.toContain('nonsense-private-text');
    for (const fragment of keyFragments(throwawayPrivateKey())) {
      expect(problem).not.toContain(fragment);
    }
  });

  it('names the bucket setting when the bucket is not a bucket name', () => {
    keyFile();
    vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'Not A Bucket!');
    resetEnvForTests();
    expect(storageProblem()).toContain('FIREBASE_STORAGE_BUCKET');
  });

  it('is null again once the file is there: a failed start is not remembered', () => {
    const file = keyFile();
    rmSync(file);
    expect(storageProblem()).not.toBeNull();
    writeFileSync(file, JSON.stringify(serviceAccountFixture()));
    expect(storageProblem()).toBeNull();
  });

  it('does not report an invalid environment as a storage problem', () => {
    vi.stubEnv('WORKER_CONCURRENCY', 'many');
    resetEnvForTests();
    expect(() => storageProblem()).toThrow(EnvError);
  });

  it('is null when a driver was injected, as in tests', () => {
    setStorageOverride(fakeStorage());
    expect(storageProblem()).toBeNull();
  });
});
