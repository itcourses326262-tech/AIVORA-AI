import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLogger } from '@/server/logger';
import { setStorageOverride } from '@/server/storage';
import type { StorageDriver } from '@/server/storage/types';
import { deleteAssetObjects, removeAssetObjects } from '@/server/uploads';
import { fakeStorage } from '../../helpers/fakes';

afterEach(() => {
  setStorageOverride(null);
});

const bytes = new Uint8Array([1]);

async function seed(storage: ReturnType<typeof fakeStorage>, keys: string[]) {
  for (const key of keys) await storage.put(key, bytes, { mimeType: 'image/png' });
}

describe('removeAssetObjects', () => {
  it('deletes the object and its thumbnail for every asset', async () => {
    const storage = fakeStorage();
    await seed(storage, ['u/a/g/1.png', 'u/a/g/1.thumb.webp', 'u/a/g/2.mp4', 'u/b/g/3.png']);
    await removeAssetObjects(storage, [
      { storageKey: 'u/a/g/1.png', thumbKey: 'u/a/g/1.thumb.webp' },
      { storageKey: 'u/a/g/2.mp4', thumbKey: null },
    ]);
    expect([...storage.objects.keys()]).toEqual(['u/b/g/3.png']);
  });

  it('does nothing for an empty list and tolerates objects that are already gone', async () => {
    const storage = fakeStorage();
    await removeAssetObjects(storage, []);
    await expect(
      removeAssetObjects(storage, [{ storageKey: 'u/a/g/missing.png', thumbKey: null }]),
    ).resolves.toBeUndefined();
  });

  it('keeps going and does not throw when a delete fails', async () => {
    const storage = fakeStorage();
    await seed(storage, ['u/a/g/1.png', 'u/a/g/2.png', 'u/a/g/3.png']);
    const failing: StorageDriver = {
      ...storage,
      delete: async (key) => {
        if (key.endsWith('2.png')) throw new Error('S3 unavailable');
        await storage.delete(key);
      },
    };
    const warn = vi.spyOn(getLogger(), 'warn').mockImplementation(() => undefined);
    await expect(
      removeAssetObjects(failing, [
        { storageKey: 'u/a/g/1.png', thumbKey: null },
        { storageKey: 'u/a/g/2.png', thumbKey: null },
        { storageKey: 'u/a/g/3.png', thumbKey: null },
      ]),
    ).resolves.toBeUndefined();
    expect([...storage.objects.keys()]).toEqual(['u/a/g/2.png']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ key: 'u/a/g/2.png' });
  });

  it('handles many assets in batches', async () => {
    const storage = fakeStorage();
    const keys = Array.from({ length: 50 }, (_, i) => `u/a/g/${i}.png`);
    await seed(storage, keys);
    await removeAssetObjects(
      storage,
      keys.map((storageKey) => ({ storageKey, thumbKey: null })),
    );
    expect(storage.objects.size).toBe(0);
  });
});

describe('deleteAssetObjects', () => {
  it('uses the configured storage', async () => {
    const storage = fakeStorage();
    await seed(storage, ['u/a/g/1.png', 'u/a/g/1.thumb.webp']);
    setStorageOverride(storage);
    await deleteAssetObjects([{ storageKey: 'u/a/g/1.png', thumbKey: 'u/a/g/1.thumb.webp' }]);
    expect(storage.objects.size).toBe(0);
  });
});
