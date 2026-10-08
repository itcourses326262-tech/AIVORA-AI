import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import { fakeStorage } from '../../helpers/fakes';

// The drivers themselves belong to the storage owner; this file only tests the wiring.
const mocks = vi.hoisted(() => ({ createLocalStorage: vi.fn(), createS3Storage: vi.fn() }));
vi.mock('@/server/storage/local', () => ({ createLocalStorage: mocks.createLocalStorage }));
vi.mock('@/server/storage/s3', () => ({ createS3Storage: mocks.createS3Storage }));

import { getStorage, setStorageOverride } from '@/server/storage';

const GLOBAL_KEY = Symbol.for('aivore.storage');

function forgetCachedDriver() {
  (globalThis as Record<symbol, unknown>)[GLOBAL_KEY] = undefined;
}

beforeEach(() => {
  mocks.createLocalStorage.mockReset().mockImplementation(() => fakeStorage());
  mocks.createS3Storage.mockReset().mockImplementation(() => fakeStorage());
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
