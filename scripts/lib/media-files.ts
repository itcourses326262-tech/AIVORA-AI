// What is on disk under STORAGE_LOCAL_DIR, as storage keys. Shared by `setup:firebase` (is there
// anything to move?) and `migrate:media` (move it).
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isValidStorageKey } from '@/server/storage/keys';

export interface LocalObject {
  key: string;
  size: number;
}

export interface LocalListing {
  objects: LocalObject[];
  /** Files the storage layer would never serve (links, odd names): reported, never copied. */
  ignored: Array<{ path: string; reason: string }>;
}

/**
 * Objects are the plain files; the hidden `.<name>.meta` sidecars and `.tmp-*` files of the local
 * driver, and anything else starting with a dot, are bookkeeping and are skipped. Symbolic links
 * are refused, exactly as the local driver refuses them.
 */
export async function listLocalObjects(root: string): Promise<LocalListing> {
  const objects: LocalObject[] = [];
  const ignored: LocalListing['ignored'] = [];

  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        ignored.push({ path: relative, reason: 'symbolic link' });
      } else if (entry.isDirectory()) {
        await walk(full, relative);
      } else if (entry.isFile()) {
        if (!isValidStorageKey(relative)) {
          ignored.push({ path: relative, reason: 'not a valid storage key' });
          continue;
        }
        objects.push({ key: relative, size: (await lstat(full)).size });
      }
    }
  }

  await walk(root, '');
  objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { objects, ignored };
}

/** True as soon as one object is found; false for a missing or empty directory. */
export async function hasLocalMedia(root: string): Promise<boolean> {
  async function anyFile(directory: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isFile()) return true;
      if (entry.isDirectory() && (await anyFile(path.join(directory, entry.name)))) return true;
    }
    return false;
  }
  return anyFile(root);
}
