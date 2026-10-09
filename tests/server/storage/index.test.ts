import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import { fakeStorage } from '../../helpers/fakes';

// The drivers themselves belong to the storage owner; this file only tests the wiring.
const mocks = vi.hoisted(() => ({
  createLocalStorage: vi.fn(),
  createS3Storage: vi.fn(),
  createGcsStorage: vi.fn(),
}));
vi.mock('@/server/storage/local', () => ({ createLocalStorage: mocks.createLocalStorage }));
vi.mock('@/server/storage/s3', () => ({ createS3Storage: mocks.createS3Storage }));
vi.mock('@/server/storage/gcs', () => ({ createGcsStorage: mocks.createGcsStorage }));

import { getStorage, setStorageOverride, storageProblem } from '@/server/storage';

const GLOBAL_KEY = Symbol.for('aivore.storage');

function forgetCachedDriver() {
  (globalThis as Record<symbol, unknown>)[GLOBAL_KEY] = undefined;
}

beforeEach(() => {
  mocks.createLocalStorage.mockReset().mockImplementation(() => fakeStorage());
  mocks.createS3Storage.mockReset().mockImplementation(() => fakeStorage());
  mocks.createGcsStorage.mockReset().mockImplementation(() => fakeStorage());
  forgetCachedDriver();
  resetEnvForTests();
});

afterEach(() => {
  setStorageOverride(null);
  forgetCachedDriver();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe('getStorage', () => {
  it('creates the local driver on first use for the configured directory, then reuses it', () => {
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('STORAGE_LOCAL_DIR', '/var/aivore/media');
    expect(mocks.createLocalStorage).not.toHaveBeenCalled();
    const first = getStorage();
    expect(getStorage()).toBe(first);
    expect(mocks.createLocalStorage).toHaveBeenCalledOnce();
    expect(mocks.createLocalStorage).toHaveBeenCalledWith('/var/aivore/media');
    expect(mocks.createS3Storage).not.toHaveBeenCalled();
  });

  it('creates the S3 driver from the env when STORAGE_DRIVER=s3', () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    vi.stubEnv('S3_BUCKET', 'media');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'id');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'secret');
    const driver = getStorage();
    expect(getStorage()).toBe(driver);
    expect(mocks.createS3Storage).toHaveBeenCalledOnce();
    expect(mocks.createS3Storage.mock.calls[0]?.[0]).toMatchObject({ S3_BUCKET: 'media' });
    expect(mocks.createLocalStorage).not.toHaveBeenCalled();
  });

  it('creates the Google Cloud Storage driver from the env when STORAGE_DRIVER=gcs', () => {
    vi.stubEnv('STORAGE_DRIVER', 'gcs');
    vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo.firebasestorage.app');
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', '/data/firebase-service-account.json');
    expect(mocks.createGcsStorage).not.toHaveBeenCalled();
    const driver = getStorage();
    expect(getStorage()).toBe(driver);
    expect(mocks.createGcsStorage).toHaveBeenCalledOnce();
    expect(mocks.createGcsStorage.mock.calls[0]?.[0]).toMatchObject({
      FIREBASE_STORAGE_BUCKET: 'demo.firebasestorage.app',
    });
    expect(mocks.createLocalStorage).not.toHaveBeenCalled();
    expect(mocks.createS3Storage).not.toHaveBeenCalled();
  });

  it('writes the bucket the same way however it was typed, so the driver is created once', () => {
    vi.stubEnv('STORAGE_DRIVER', 'gcs');
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '{}');
    vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'gs://demo.firebasestorage.app/');
    const driver = getStorage();
    vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo.firebasestorage.app');
    resetEnvForTests();
    expect(getStorage()).toBe(driver);
    expect(mocks.createGcsStorage).toHaveBeenCalledOnce();
    expect(mocks.createGcsStorage.mock.calls[0]?.[0]).toMatchObject({
      FIREBASE_STORAGE_BUCKET: 'demo.firebasestorage.app',
    });
  });

  describe('storageProblem', () => {
    beforeEach(() => {
      vi.stubEnv('STORAGE_DRIVER', 'gcs');
      vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo.firebasestorage.app');
      vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '{}');
      resetEnvForTests();
    });

    it('is null while the driver can be created, and does not create a second one', () => {
      expect(storageProblem()).toBeNull();
      expect(storageProblem()).toBeNull();
      expect(mocks.createGcsStorage).toHaveBeenCalledOnce();
    });

    it('puts whatever the driver complained about on one bounded line, behind the setting', () => {
      mocks.createGcsStorage.mockImplementation(() => {
        throw new Error(`first line\n  second line ${'x'.repeat(1000)}`);
      });
      const problem = storageProblem() as string;
      expect(
        problem.startsWith('Storage is not usable (STORAGE_DRIVER=gcs): first line second line'),
      ).toBe(true);
      expect(problem).not.toMatch(/\s{2}|\n/);
      expect(problem.length).toBeLessThan(400);
    });
  });

  it('builds a new gcs driver when the bucket changes, and a local one when it is switched off', () => {
    vi.stubEnv('STORAGE_DRIVER', 'gcs');
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '{}');
    vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'bucket-a');
    getStorage();
    vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'bucket-b');
    resetEnvForTests();
    getStorage();
    expect(mocks.createGcsStorage).toHaveBeenCalledTimes(2);
    vi.stubEnv('STORAGE_DRIVER', 'local');
    resetEnvForTests();
    getStorage();
    expect(mocks.createLocalStorage).toHaveBeenCalledOnce();
  });

  it('builds a new driver when the configuration changes', () => {
    vi.stubEnv('STORAGE_LOCAL_DIR', '/a');
    getStorage();
    vi.stubEnv('STORAGE_LOCAL_DIR', '/b');
    resetEnvForTests();
    getStorage();
    expect(mocks.createLocalStorage.mock.calls.map((call) => call[0])).toEqual(['/a', '/b']);
  });

  it('returns the injected driver without touching the configuration', () => {
    const fake = fakeStorage();
    setStorageOverride(fake);
    expect(getStorage()).toBe(fake);
    expect(mocks.createLocalStorage).not.toHaveBeenCalled();

    setStorageOverride(null);
    expect(getStorage()).not.toBe(fake);
  });
});
